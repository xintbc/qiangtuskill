/* ============================================================================
   网页视图.c —— 内嵌 WebView2（纯 C，手写 COM 回调）
   ----------------------------------------------------------------------------
   WebView2 的启动是异步两步：
     ① CreateCoreWebView2EnvironmentWithOptions(...)  → 回调里拿到「环境」
     ② 环境->CreateCoreWebView2Controller(hwnd, ...)  → 回调里拿到「控制器」
     ③ 控制器->get_CoreWebView2()                     → 拿到「网页」，再导航
   两个回调都是 COM 接口，纯 C 里没有现成的实现类 → 这里自己写 vtable
   （结构体第一个字段就是 Vtbl 指针，方法签名与 sdk/WebView2.h 里的完全一致）。

   ⚠️ 三个容易翻车的点（都写在对应位置）：
     · 回调对象必须自己管引用计数（AddRef/Release/QueryInterface 一个都不能少）
     · 回调是**异步**的，函数返回时控件还没好 → 别在启动函数里立刻 Navigate
     · 本文件用 g_ 静态变量存句柄，只支持"一个窗口一个视图"（本客户端正好是）
   ========================================================================= */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objbase.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>

#include "sdk/WebView2.h"
#include "网页视图.h"

/* 虚拟站点名：把本地目录当成一个 https 站点。
   用 game.example（`.example` 是 IANA 保留给示例的顶级域，不会被真解析走）。 */
static const WCHAR 虚拟主机[] = L"game.example";

static ICoreWebView2Environment *g_env = NULL;
static ICoreWebView2Controller  *g_ctrl = NULL;
static ICoreWebView2            *g_web = NULL;
static HWND  g_父窗口 = NULL;
static WCHAR g_根目录[MAX_PATH * 2] = { 0 };
static char  g_服务器[128] = { 0 };
static BOOL  g_已导航 = FALSE;

/* ============================================================ 环境选项对象
   用途只有一个：把 AdditionalBrowserArguments 传给内核 —— 性能全靠它。
   ─ 参数说明（都是 Chromium/WebView2 认的）：
     --disable-features=CalculateNativeWinOcclusion
         ⚠️ 最关键的一条。Windows 会算"这个窗口被挡住了多少"，被遮住就给它降频。
            游戏窗口一旦被别的窗口压住（哪怕只压一角），帧率会悄悄掉一半。
      --disable-background-timer-throttling / --disable-renderer-backgrounding
        切到后台时不把定时器和渲染线程降频（玩家切出去再切回来不会卡一下）。
     --disable-backgrounding-occluded-windows  同上，别因为"被遮挡"就把渲染停掉。
     --autoplay-policy=no-user-gesture-required  音频不需要先点一下才响。
     --force_high_performance_gpu  双显卡笔记本强制用独显（集显跑这个 3D 会很难受）。
     --enable-gpu-rasterization    GPU 光栅化，画布合成更快。 */
typedef struct {
    ICoreWebView2EnvironmentOptionsVtbl *lpVtbl;
    LONG 引用;
    WCHAR 参数[1024];
} 环境选项对象;

static 环境选项对象 选对象;

static HRESULT STDMETHODCALLTYPE 选_QueryInterface(ICoreWebView2EnvironmentOptions *This, REFIID riid, void **ppv);
static ULONG   STDMETHODCALLTYPE 选_AddRef(ICoreWebView2EnvironmentOptions *This);
static ULONG   STDMETHODCALLTYPE 选_Release(ICoreWebView2EnvironmentOptions *This);
static HRESULT STDMETHODCALLTYPE 选_取参数(ICoreWebView2EnvironmentOptions *This, LPWSTR *值);
static HRESULT STDMETHODCALLTYPE 选_设参数(ICoreWebView2EnvironmentOptions *This, LPCWSTR 值);
static HRESULT STDMETHODCALLTYPE 选_取语言(ICoreWebView2EnvironmentOptions *This, LPWSTR *值);
static HRESULT STDMETHODCALLTYPE 选_设语言(ICoreWebView2EnvironmentOptions *This, LPCWSTR 值);
static HRESULT STDMETHODCALLTYPE 选_取兼容版本(ICoreWebView2EnvironmentOptions *This, LPWSTR *值);
static HRESULT STDMETHODCALLTYPE 选_设兼容版本(ICoreWebView2EnvironmentOptions *This, LPCWSTR 值);
static HRESULT STDMETHODCALLTYPE 选_取SSO(ICoreWebView2EnvironmentOptions *This, BOOL *值);
static HRESULT STDMETHODCALLTYPE 选_设SSO(ICoreWebView2EnvironmentOptions *This, BOOL 值);

static ICoreWebView2EnvironmentOptionsVtbl 选虚表 = {
    选_QueryInterface, 选_AddRef, 选_Release,
    选_取参数, 选_设参数,
    选_取语言, 选_设语言,
    选_取兼容版本, 选_设兼容版本,
    选_取SSO, 选_设SSO
};

static HRESULT STDMETHODCALLTYPE 选_QueryInterface(ICoreWebView2EnvironmentOptions *This, REFIID riid, void **ppv)
{
    (void)This;
    if (!ppv) return E_POINTER;
    if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, &IID_ICoreWebView2EnvironmentOptions)) {
        *ppv = &选对象;
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE 选_AddRef(ICoreWebView2EnvironmentOptions *This) { (void)This; return (ULONG)InterlockedIncrement(&选对象.引用); }
static ULONG STDMETHODCALLTYPE 选_Release(ICoreWebView2EnvironmentOptions *This) { (void)This; return (ULONG)InterlockedDecrement(&选对象.引用); }

static HRESULT STDMETHODCALLTYPE 选_取参数(ICoreWebView2EnvironmentOptions *This, LPWSTR *值)
{
    (void)This;
    if (!值) return E_POINTER;
    size_t 字节 = (wcslen(选对象.参数) + 1) * sizeof(WCHAR);
    *值 = (LPWSTR)CoTaskMemAlloc(字节);
    if (!*值) return E_OUTOFMEMORY;
    memcpy(*值, 选对象.参数, 字节);
    return S_OK;
}
static HRESULT STDMETHODCALLTYPE 选_设参数(ICoreWebView2EnvironmentOptions *This, LPCWSTR 值)
{
    (void)This;
    if (值) lstrcpynW(选对象.参数, 值, 1024);
    return S_OK;
}
static HRESULT STDMETHODCALLTYPE 选_取语言(ICoreWebView2EnvironmentOptions *This, LPWSTR *值)
{
    (void)This;
    if (!值) return E_POINTER;
    *值 = (LPWSTR)CoTaskMemAlloc(sizeof(WCHAR));
    if (!*值) return E_OUTOFMEMORY;
    (*值)[0] = 0;
    return S_OK;
}
static HRESULT STDMETHODCALLTYPE 选_设语言(ICoreWebView2EnvironmentOptions *This, LPCWSTR 值) { (void)This; (void)值; return S_OK; }
static HRESULT STDMETHODCALLTYPE 选_取兼容版本(ICoreWebView2EnvironmentOptions *This, LPWSTR *值)
{
    (void)This;
    if (!值) return E_POINTER;
    *值 = (LPWSTR)CoTaskMemAlloc(sizeof(WCHAR));
    if (!*值) return E_OUTOFMEMORY;
    (*值)[0] = 0;
    return S_OK;
}
static HRESULT STDMETHODCALLTYPE 选_设兼容版本(ICoreWebView2EnvironmentOptions *This, LPCWSTR 值) { (void)This; (void)值; return S_OK; }
static HRESULT STDMETHODCALLTYPE 选_取SSO(ICoreWebView2EnvironmentOptions *This, BOOL *值) { (void)This; if (值) *值 = FALSE; return S_OK; }
static HRESULT STDMETHODCALLTYPE 选_设SSO(ICoreWebView2EnvironmentOptions *This, BOOL 值) { (void)This; (void)值; return S_OK; }

/* ================================================================ 第一个回调
   ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler */
typedef struct {
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl *lpVtbl;
    LONG 引用;
} 环境回调对象;

/* ================================================================ 第二个回调
   ICoreWebView2CreateCoreWebView2ControllerCompletedHandler */
typedef struct {
    ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl *lpVtbl;
    LONG 引用;
} 控制回调对象;

static HRESULT STDMETHODCALLTYPE 控_QueryInterface(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This, REFIID riid, void **ppv);
static ULONG   STDMETHODCALLTYPE 控_AddRef(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This);
static ULONG   STDMETHODCALLTYPE 控_Release(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This);
static HRESULT STDMETHODCALLTYPE 控_Invoke(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This, HRESULT 结果, ICoreWebView2Controller *控制器);

static ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl 控虚表 = {
    控_QueryInterface, 控_AddRef, 控_Release, 控_Invoke
};
static 控制回调对象 控对象 = { &控虚表, 1 };

static HRESULT STDMETHODCALLTYPE 环_QueryInterface(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This, REFIID riid, void **ppv);
static ULONG   STDMETHODCALLTYPE 环_AddRef(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This);
static ULONG   STDMETHODCALLTYPE 环_Release(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This);
static HRESULT STDMETHODCALLTYPE 环_Invoke(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This, HRESULT 结果, ICoreWebView2Environment *环境);

static ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl 环虚表 = {
    环_QueryInterface, 环_AddRef, 环_Release, 环_Invoke
};
static 环境回调对象 环对象 = { &环虚表, 1 };

/* ---------------------------------------------------------------- 公共小工具 */

/* 启动日志：出问题先看这个文件（客户端\启动日志.txt）。
   内核是异步起来的，很多失败只表现为"窗口一片空白"，光看窗口根本查不出来。 */
static void 写日志(const WCHAR *格式, ...)
{
    WCHAR exe目录[MAX_PATH * 2] = { 0 }, 路径[MAX_PATH * 2] = { 0 };
    GetModuleFileNameW(NULL, exe目录, MAX_PATH * 2);
    WCHAR *斜 = wcsrchr(exe目录, L'\\');
    if (斜) *斜 = 0;
    _snwprintf(路径, MAX_PATH * 2 - 1, L"%s\\启动日志.txt", exe目录);

    /* ⚠️ 别用 _wfopen(L"a, ccs=UTF-8")：那是 MSVC 的扩展，MinGW 的 msvcrt 不认，
       结果整份日志变成乱码。这里自己把宽串转成 UTF-8 再按二进制写。 */
    WCHAR 行[2048];
    va_list ap;
    va_start(ap, 格式);
    _vsnwprintf(行, 2047, 格式, ap);
    va_end(ap);

    char utf8[8192] = { 0 };
    WideCharToMultiByte(CP_UTF8, 0, 行, -1, utf8, sizeof(utf8) - 1, NULL, NULL);

    FILE *f = _wfopen(路径, L"ab");
    if (!f) return;
    SYSTEMTIME t; GetLocalTime(&t);
    char 时间[32];
    _snprintf(时间, sizeof(时间) - 1, "[%02d:%02d:%02d] ", t.wHour, t.wMinute, t.wSecond);
    fwrite(时间, 1, strlen(时间), f);
    fwrite(utf8, 1, strlen(utf8), f);
    fwrite("\r\n", 1, 2, f);
    fclose(f);
}

static void 取exe目录(WCHAR *输出, int 容量)
{
    GetModuleFileNameW(NULL, 输出, (DWORD)容量);
    WCHAR *斜 = wcsrchr(输出, L'\\');
    if (斜) *斜 = 0;
}

static void 拼路径(WCHAR *输出, int 容量, const WCHAR *a, const WCHAR *b)
{
    /* ⚠️ 不能把同一个缓冲区同时当 GetFullPathNameW 的输入和输出（行为未定义，
       实测会把结果清成空串 → userDataFolder 变空 → 内核退回系统默认目录）。 */
    WCHAR 临时[MAX_PATH * 2] = { 0 };
    _snwprintf(临时, MAX_PATH * 2 - 1, L"%s\\%s", a, b);
    if (!GetFullPathNameW(临时, (DWORD)容量, 输出, NULL)) lstrcpynW(输出, 临时, 容量);
}

static void 建目录(const WCHAR *路径)
{
    /* 逐级创建（SHCreateDirectoryEx 在 shell32 里，这里手写省一个依赖） */
    WCHAR 临时[MAX_PATH * 2];
    lstrcpynW(临时, 路径, MAX_PATH * 2);
    for (WCHAR *p = 临时 + 3; *p; p++) {
        if (*p == L'\\') { *p = 0; CreateDirectoryW(临时, NULL); *p = L'\\'; }
    }
    CreateDirectoryW(临时, NULL);
}

/* 注入到每个 document 创建时（早于页面自己的脚本）：
   ① 把客户端探测到的服务器地址写进 localStorage —— 游戏"多人"面板会自动填；
   ② 打一个标记，页面/排查时能知道"我在客户端里跑"。 */
static void 注入配置(void)
{
    if (!g_web) return;
    WCHAR js[1024];
    if (g_服务器[0]) {
        WCHAR 宽主机[128] = { 0 };
        MultiByteToWideChar(CP_UTF8, 0, g_服务器, -1, 宽主机, 128);
        _snwprintf(js, 1023,
            L"try{localStorage.setItem('gunGame.netServer.v1','%s');"
            L"window.__clientHost='%s';window.__inClient=1;}catch(e){}"
            /* 页面自检：2.5 秒后把结果写进标题，客户端读出来记到日志里。
               这样"白屏到底是没加载，还是加载了但引擎崩了"一眼能分清。 */
            L"setTimeout(function(){try{"
            L"document.title='[自检] 引擎:'+(typeof S==='object'?'ok':'fail')"
            L"+' Three:'+(typeof THREE!=='undefined'?'ok':'fail')"
            L"+' 脚本:'+document.scripts.length"
            L"+' 名字:'+((typeof S==='object'&&S&&S.playerName)||'无');"
            L"}catch(e){document.title='[自检] 异常:'+e;}},2500);",
            宽主机, 宽主机);
    } else {
        _snwprintf(js, 1023,
            L"try{window.__inClient=1;window.__clientHost='';}catch(e){}"
            L"setTimeout(function(){try{"
            L"document.title='[自检] 引擎:'+(typeof S==='object'?'ok':'fail')"
            L"+' Three:'+(typeof THREE!=='undefined'?'ok':'fail')"
            L"+' 脚本:'+document.scripts.length"
            L"+' 名字:'+((typeof S==='object'&&S&&S.playerName)||'无');"
            L"}catch(e){document.title='[自检] 异常:'+e;}},2500);");
    }
    g_web->lpVtbl->AddScriptToExecuteOnDocumentCreated(g_web, js, NULL);
}

/* ============================================================ 导航完成回调
   有了它，日志里就能看到"页面成功/失败、错误码是多少"。
   否则内核起不来、虚拟站点没映射对、文件缺失 —— 全都只表现成"白屏"，没法查。 */
typedef struct {
    ICoreWebView2NavigationCompletedEventHandlerVtbl *lpVtbl;
    LONG 引用;
} 导航回调对象;

static 导航回调对象 导对象;

static HRESULT STDMETHODCALLTYPE 导_QueryInterface(ICoreWebView2NavigationCompletedEventHandler *This, REFIID riid, void **ppv);
static ULONG   STDMETHODCALLTYPE 导_AddRef(ICoreWebView2NavigationCompletedEventHandler *This);
static ULONG   STDMETHODCALLTYPE 导_Release(ICoreWebView2NavigationCompletedEventHandler *This);
static HRESULT STDMETHODCALLTYPE 导_Invoke(ICoreWebView2NavigationCompletedEventHandler *This, ICoreWebView2 *发送者, ICoreWebView2NavigationCompletedEventArgs *参数);

static ICoreWebView2NavigationCompletedEventHandlerVtbl 导虚表 = {
    导_QueryInterface, 导_AddRef, 导_Release, 导_Invoke
};

static HRESULT STDMETHODCALLTYPE 导_QueryInterface(ICoreWebView2NavigationCompletedEventHandler *This, REFIID riid, void **ppv)
{
    (void)This;
    if (!ppv) return E_POINTER;
    if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, &IID_ICoreWebView2NavigationCompletedEventHandler)) {
        *ppv = &导对象;
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE 导_AddRef(ICoreWebView2NavigationCompletedEventHandler *This) { (void)This; return (ULONG)InterlockedIncrement(&导对象.引用); }
static ULONG STDMETHODCALLTYPE 导_Release(ICoreWebView2NavigationCompletedEventHandler *This) { (void)This; return (ULONG)InterlockedDecrement(&导对象.引用); }

static HRESULT STDMETHODCALLTYPE 导_Invoke(ICoreWebView2NavigationCompletedEventHandler *This, ICoreWebView2 *发送者, ICoreWebView2NavigationCompletedEventArgs *参数)
{
    (void)This; (void)发送者;
    BOOL 成功 = FALSE;
    COREWEBVIEW2_WEB_ERROR_STATUS 错误 = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
    if (参数) {
        参数->lpVtbl->get_IsSuccess(参数, &成功);
        参数->lpVtbl->get_WebErrorStatus(参数, &错误);
    }
    写日志(L"导航完成 成功=%d 错误码=%d", 成功, (int)错误);
    return S_OK;
}

/* 控制器好了之后：配置 + 建虚拟站点 + 导航 */
static void 控制器就绪(ICoreWebView2Controller *控制器)
{
    g_ctrl = 控制器;
    控制器->lpVtbl->AddRef(控制器);

    控制器->lpVtbl->put_IsVisible(控制器, TRUE);

    HRESULT hr取网页 = 控制器->lpVtbl->get_CoreWebView2(控制器, &g_web);
    写日志(L"get_CoreWebView2 hr=0x%08X web=%p", (unsigned)hr取网页, (void *)g_web);
    if (SUCCEEDED(hr取网页) && g_web) {
        /* ---- 外观：去掉一切"浏览器感" ---- */
        ICoreWebView2Settings *设置 = NULL;
        if (SUCCEEDED(g_web->lpVtbl->get_Settings(g_web, &设置)) && 设置) {
            设置->lpVtbl->put_AreDefaultContextMenusEnabled(设置, FALSE);   /* 右键菜单 */
            设置->lpVtbl->put_IsStatusBarEnabled(设置, FALSE);              /* 左下角网址 */
            设置->lpVtbl->put_IsZoomControlEnabled(设置, FALSE);            /* Ctrl+滚轮缩放 */
            设置->lpVtbl->put_AreDevToolsEnabled(设置, TRUE);               /* 作者调试用 F12，玩家基本不会碰 */
            设置->lpVtbl->Release(设置);
        }

        /* ---- 把本地目录映射成 https://game.example/ ----
           用 https 而不是 file://：file:// 下 fetch/模块/部分存储 API 会被禁，
           而这个虚拟站点在浏览器眼里就是一个正常的安全源，全部照常。 */
        ICoreWebView2_3 *w3 = NULL;
        HRESULT hr3 = g_web->lpVtbl->QueryInterface(g_web, &IID_ICoreWebView2_3, (void **)&w3);
        写日志(L"QueryInterface(ICoreWebView2_3) hr=0x%08X w3=%p", (unsigned)hr3, (void *)w3);
        if (SUCCEEDED(hr3) && w3) {
            HRESULT hr映 = w3->lpVtbl->SetVirtualHostNameToFolderMapping(
                w3, 虚拟主机, g_根目录, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
            写日志(L"映射本地目录 %s -> %s hr=0x%08X", g_根目录, 虚拟主机, (unsigned)hr映);
            w3->lpVtbl->Release(w3);
        }

        /* 注册导航完成回调（日志里能看到页面到底加载出来没有） */
        导对象.lpVtbl = &导虚表;
        导对象.引用 = 1;
        { EventRegistrationToken 令牌 = { 0 };
          HRESULT hrE = g_web->lpVtbl->add_NavigationCompleted(g_web, (ICoreWebView2NavigationCompletedEventHandler *)&导对象, &令牌);
          写日志(L"注册导航完成事件 hr=0x%08X", (unsigned)hrE); }

        注入配置();
        网页视图_铺满();

        /* 导航到游戏本体 */
        if (!g_已导航) {
            g_已导航 = TRUE;
            HRESULT hrN = g_web->lpVtbl->Navigate(g_web, L"https://game.example/index.html");
            写日志(L"Navigate hr=0x%08X", (unsigned)hrN);
        }
    }
}

/* ------------------------------------------------------------ 回调实现（环境） */

static HRESULT STDMETHODCALLTYPE 环_QueryInterface(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This, REFIID riid, void **ppv)
{
    (void)This;
    if (!ppv) return E_POINTER;
    if (IsEqualIID(riid, &IID_IUnknown) ||
        IsEqualIID(riid, &IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler)) {
        *ppv = &环对象;
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE 环_AddRef(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This)
{
    (void)This;
    return (ULONG)InterlockedIncrement(&环对象.引用);
}
static ULONG STDMETHODCALLTYPE 环_Release(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This)
{
    (void)This;
    return (ULONG)InterlockedDecrement(&环对象.引用);
}
static HRESULT STDMETHODCALLTYPE 环_Invoke(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This, HRESULT 结果, ICoreWebView2Environment *环境)
{
    (void)This;
    写日志(L"环境回调 hr=0x%08X env=%p", (unsigned)结果, (void *)环境);
    if (FAILED(结果) || !环境) return S_OK;          /* 内核没起来：由调用方提示用户 */
    g_env = 环境;
    环境->lpVtbl->AddRef(环境);
    环境->lpVtbl->CreateCoreWebView2Controller(环境, g_父窗口,
        (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *)&控对象);
    return S_OK;
}

/* ---------------------------------------------------------- 回调实现（控制器） */

static HRESULT STDMETHODCALLTYPE 控_QueryInterface(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This, REFIID riid, void **ppv)
{
    (void)This;
    if (!ppv) return E_POINTER;
    if (IsEqualIID(riid, &IID_IUnknown) ||
        IsEqualIID(riid, &IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler)) {
        *ppv = &控对象;
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE 控_AddRef(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This)
{
    (void)This;
    return (ULONG)InterlockedIncrement(&控对象.引用);
}
static ULONG STDMETHODCALLTYPE 控_Release(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This)
{
    (void)This;
    return (ULONG)InterlockedDecrement(&控对象.引用);
}
static HRESULT STDMETHODCALLTYPE 控_Invoke(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This, HRESULT 结果, ICoreWebView2Controller *控制器)
{
    (void)This;
    写日志(L"控制器回调 hr=0x%08X ctrl=%p", (unsigned)结果, (void *)控制器);
    if (FAILED(结果) || !控制器) return S_OK;
    控制器就绪(控制器);
    写日志(L"控制器就绪完成");
    return S_OK;
}

/* ------------------------------------------------------------------ 对外接口 */

BOOL 网页视图_启动(HWND 父窗口, const wchar_t *根目录, const char *服务器地址)
{
    g_父窗口 = 父窗口;
    lstrcpynW(g_根目录, 根目录, MAX_PATH * 2);
    if (服务器地址) {
        strncpy(g_服务器, 服务器地址, sizeof(g_服务器) - 1);
        g_服务器[sizeof(g_服务器) - 1] = 0;
    }

    /* WebView2Loader 在 exe 旁边的 sdk\ 里。
       ⚠️ 必须用**绝对路径**：相对路径是按"当前工作目录"找的，双击 exe 时工作目录
          常常不是 exe 目录（被快捷方式/别的程序拉起就更乱），结果就是"内核起不来、窗口全白"
          —— 第一次就踩了这个。 */
    WCHAR exe目录0[MAX_PATH * 2] = { 0 }, dll路径[MAX_PATH * 2] = { 0 };
    取exe目录(exe目录0, MAX_PATH * 2);
    写日志(L"--- 启动 --- 根目录=%s", g_根目录);
    写日志(L"exe目录=%s", exe目录0);
    HMODULE 载入器 = NULL;
    _snwprintf(dll路径, MAX_PATH * 2 - 1, L"%s\\sdk\\WebView2Loader.dll", exe目录0);
    载入器 = LoadLibraryW(dll路径);
    写日志(L"Loader 载入=%s (%s)", 载入器 ? L"成功" : L"失败", dll路径);
    if (!载入器) { _snwprintf(dll路径, MAX_PATH * 2 - 1, L"%s\\WebView2Loader.dll", exe目录0); 载入器 = LoadLibraryW(dll路径); }
    if (!载入器) 载入器 = LoadLibraryW(L"WebView2Loader.dll");
    if (!载入器) {
        MessageBoxW(g_父窗口,
            L"找不到 WebView2Loader.dll。\n\n它应该在「客户端\\sdk\\」里面，别把它删了或单独移走 exe。",
            L"缺少内核组件", MB_ICONERROR | MB_OK);
        return FALSE;
    }

    typedef HRESULT (STDAPICALLTYPE *PFN创建环境)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions *,
        ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);
    PFN创建环境 创建环境 = (PFN创建环境)GetProcAddress(载入器, "CreateCoreWebView2EnvironmentWithOptions");
    if (!创建环境) { FreeLibrary(载入器); return FALSE; }

    /* 用户数据目录：放在 **exe 自己所在的目录** 下（存档/缓存独立，不碰系统浏览器）。
       ⚠️ 别用「根目录 + ..\\客户端」去拼：根目录已经是"多文件版"，
          再往上跳会跑到 D://mc2//客户端（第一次就拼错了，结果用户数据目录没建出来、
          内核起不来、窗口一片空白）。 */
    WCHAR exe目录[MAX_PATH * 2] = { 0 };
    取exe目录(exe目录, MAX_PATH * 2);
    WCHAR 配置目录[MAX_PATH * 2];
    拼路径(配置目录, MAX_PATH * 2, exe目录, L"配置\\网页数据");
    建目录(配置目录);

    /* 进程里必须先 CoInitialize（STA）：WebView2 的控件是单线程的 */
    写日志(L"userDataFolder=%s", 配置目录);
    /* 性能参数（说明见上面"环境选项对象"那段注释） */
    选对象.lpVtbl = &选虚表;
    选对象.引用 = 1;
    lstrcpynW(选对象.参数,
        L"--disable-features=CalculateNativeWinOcclusion "
        L"--disable-background-timer-throttling --disable-renderer-backgrounding "
        L"--disable-backgrounding-occluded-windows "
        L"--autoplay-policy=no-user-gesture-required "
        L"--force_high_performance_gpu --enable-gpu-rasterization",
        1024);
    写日志(L"内核参数=%s", 选对象.参数);

    /* ⚠️ 参数**不能**通过自己实现的 ICoreWebView2EnvironmentOptions 传：
       实测内核直接返回 E_INVALIDARG（0x80070057），整条启动链就断在那儿了
       （对象本身的 vtable 是对的，是它对外部实现比较挑剔）。
       改用官方支持的环境变量 —— 进程级、内核启动时会读，效果一样，还少一层 COM。 */
    SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 选对象.参数);

    HRESULT hr = 创建环境(NULL, 配置目录, NULL,
        (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *)&环对象);
    写日志(L"CreateCoreWebView2EnvironmentWithOptions hr=0x%08X", (unsigned)hr);
    return SUCCEEDED(hr);
}

BOOL 网页视图_就绪(void) { return g_web != NULL; }

void 网页视图_铺满(void)
{
    if (!g_ctrl || !g_父窗口) return;
    RECT rc;
    GetClientRect(g_父窗口, &rc);
    g_ctrl->lpVtbl->put_Bounds(g_ctrl, rc);
}

void 网页视图_设区域(int 左, int 上, int 宽, int 高)
{
    if (!g_ctrl) return;
    RECT rc;
    rc.left = 左; rc.top = 上; rc.right = 左 + 宽; rc.bottom = 上 + 高;
    g_ctrl->lpVtbl->put_Bounds(g_ctrl, rc);
}

void 网页视图_转到(const wchar_t *相对路径)
{
    if (!g_web || !相对路径) return;
    WCHAR url[1024];
    _snwprintf(url, 1023, L"https://game.example/%s", 相对路径);
    g_web->lpVtbl->Navigate(g_web, url);
}

void 网页视图_刷新(void)
{
    if (!g_web) return;
    g_web->lpVtbl->Reload(g_web);
}

void 网页视图_执行JS(const wchar_t *js)
{
    if (!g_web || !js) return;
    g_web->lpVtbl->ExecuteScript(g_web, js, NULL);
}

void 网页视图_自检日志(void)
{
    if (!g_web) return;
    static BOOL 记过 = FALSE;
    if (记过) return;
    LPWSTR 标题 = NULL;
    if (SUCCEEDED(g_web->lpVtbl->get_DocumentTitle(g_web, &标题)) && 标题) {
        if (wcsstr(标题, L"[自检]")) { 写日志(L"页面自检 -> %s", 标题); 记过 = TRUE; }
        CoTaskMemFree(标题);
    }
}

void 网页视图_关闭(void)
{
    if (g_ctrl) { g_ctrl->lpVtbl->Close(g_ctrl); g_ctrl->lpVtbl->Release(g_ctrl); g_ctrl = NULL; }
    if (g_web) { g_web->lpVtbl->Release(g_web); g_web = NULL; }
    if (g_env) { g_env->lpVtbl->Release(g_env); g_env = NULL; }
}
