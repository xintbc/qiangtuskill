/* ============================================================================
   游戏启动.c —— 版本目录内的独立启动器（双击即玩）
   ----------------------------------------------------------------------------
   为什么需要它：
     版本包解压出来只有 index.html，玩家双击 html 是用浏览器打开，没有窗口外壳、
     没有图标、file:// 下有些网页 API 还被禁用（IndexedDB / 麦克风）。这个 exe 把
     自己所在的目录映射成 https 虚拟站点，用内嵌 WebView2 当游戏外壳：
       · 双击 枪战突击.exe 就进游戏（不用开浏览器、不用记路径）
       · https 源 → localStorage / IndexedDB / 麦克风 全部正常
       · 存档与模组存在 exe 旁边的「配置\网页数据」，跟着这个版本目录走（多版本天然隔离）
     万一 WebView2 运行时没装/起不来 → 自动回退用默认浏览器打开 index.html（保证能玩）。

   快捷键：F11 全屏 / F5 刷新 / F12 开发者工具 / Esc 退出全屏
   ========================================================================= */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdarg.h>

#include "网页视图.h"

static HWND  g_窗 = NULL;
static BOOL  g_全屏 = FALSE;
static WPARAM g_原样式 = 0;
static RECT  g_原位置 = { 0 };
static WCHAR g_目录[MAX_PATH * 2] = { 0 };
static BOOL  g_内核起来 = FALSE;

/* ---------------------------------------------------------------- 小工具 */
static void 取自身目录(WCHAR *出, int 容量)
{
    GetModuleFileNameW(NULL, 出, (DWORD)容量);
    WCHAR *斜 = wcsrchr(出, L'\\');
    if (斜) *斜 = 0;
}

/* 从目录名里抠版本号（「…\versions\枪战突击 v1.7.0」→「v1.7.0」），抠不到就空 */
static void 取版本号(const WCHAR *目录, WCHAR *出, int 容量)
{
    出[0] = 0;
    const WCHAR *斜 = wcsrchr(目录, L'\\');
    const WCHAR *名 = 斜 ? 斜 + 1 : 目录;
    const WCHAR *v = wcsrchr(名, L'v');
    if (v && v[1] >= L'0' && v[1] <= L'9') lstrcpynW(出, v, 容量);
}

static void 写日志(const WCHAR *格式, ...)
{
    WCHAR 路径[MAX_PATH * 2], 行[2048];
    _snwprintf(路径, MAX_PATH * 2 - 1, L"%s\\启动日志.txt", g_目录);

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

/* ---------------------------------------------------------------- 全屏 */
static void 切全屏(HWND h)
{
    if (!g_全屏) {
        GetWindowRect(h, &g_原位置);
        g_原样式 = GetWindowLongPtrW(h, GWL_STYLE);
        MONITORINFO mi = { sizeof(mi) };
        if (GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mi)) {
            SetWindowLongPtrW(h, GWL_STYLE, (LONG_PTR)(g_原样式 & ~WS_OVERLAPPEDWINDOW));
            SetWindowPos(h, HWND_TOP, mi.rcMonitor.left, mi.rcMonitor.top,
                mi.rcMonitor.right - mi.rcMonitor.left, mi.rcMonitor.bottom - mi.rcMonitor.top,
                SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
            g_全屏 = TRUE;
        }
    } else {
        SetWindowLongPtrW(h, GWL_STYLE, (LONG_PTR)g_原样式);
        SetWindowPos(h, NULL, g_原位置.left, g_原位置.top,
            g_原位置.right - g_原位置.left, g_原位置.bottom - g_原位置.top,
            SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
        g_全屏 = FALSE;
    }
    网页视图_铺满();
}

/* ---------------------------------------------------------------- 回退：默认浏览器 */
static void 用浏览器打开(void)
{
    WCHAR 入口[MAX_PATH * 2];
    _snwprintf(入口, MAX_PATH * 2 - 1, L"%s\\index.html", g_目录);
    写日志(L"回退：用系统浏览器打开 %s", 入口);
    ShellExecuteW(NULL, L"open", 入口, NULL, g_目录, SW_SHOWNORMAL);
    MessageBoxW(NULL,
        L"内置游戏窗口打不开（这台电脑可能缺 WebView2 运行时）。\n\n"
        L"已经用你的默认浏览器打开游戏，照样能玩。\n"
        L"想要独立窗口的话：装一次 Microsoft Edge 浏览器就有了。",
        L"枪战突击", MB_ICONINFORMATION);
}

/* ---------------------------------------------------------------- 窗口过程 */
static LRESULT CALLBACK 窗口过程(HWND h, UINT m, WPARAM w, LPARAM l)
{
    switch (m) {
    case WM_CREATE:
        g_窗 = h;
        return 0;

    case WM_SIZE:
        网页视图_铺满();
        return 0;

    case WM_SETFOCUS:
        /* 焦点回到窗口就把键盘交给页面（不然 F11/F5 之外的游戏按键会失效） */
        return 0;

    case WM_KEYDOWN:
        if (w == VK_F11) { 切全屏(h); return 0; }
        if (w == VK_F5) { 网页视图_刷新(); return 0; }
        if (w == VK_F12) { 网页视图_执行JS(L"null"); return 0; }
        if (w == VK_ESCAPE && g_全屏) { 切全屏(h); return 0; }
        return 0;

    case WM_CLOSE:
        网页视图_关闭();
        DestroyWindow(h);
        return 0;

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

/* ---------------------------------------------------------------- 入口 */
int WINAPI wWinMain(HINSTANCE 实例, HINSTANCE 旧, PWSTR 参数, int 显示)
{
    (void)旧; (void)参数; (void)显示;

    SetProcessDPIAware();
    取自身目录(g_目录, MAX_PATH * 2);

    /* 命令行参数＝账号（启动器传 "?pclname=名字&pclcode=码&pclcid=id"）。
       拼在 index.html 后面 → 游戏端的「启动器账号注入」会写进 localStorage，
       于是所有版本共用启动器那一份账号。 */
    {
        int 个数 = 0;
        LPWSTR *实参 = CommandLineToArgvW(GetCommandLineW(), &个数);
        if (实参 && 个数 >= 2 && 实参[1][0]) {
            WCHAR 路径[1024];
            if (实参[1][0] == L'?') _snwprintf(路径, 1023, L"index.html%s", 实参[1]);
            else _snwprintf(路径, 1023, L"index.html?%s", 实参[1]);
            网页视图_设初始路径(路径);
        }
        if (实参) LocalFree(实参);
    }

    /* 前置检查：目录里没有 index.html 说明包不完整 */
    WCHAR 入口[MAX_PATH * 2];
    _snwprintf(入口, MAX_PATH * 2 - 1, L"%s\\index.html", g_目录);
    if (GetFileAttributesW(入口) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(NULL,
            L"这个版本不完整：目录里找不到 index.html。\n\n"
            L"请回到启动器把这个版本「重新下载」一次。",
            L"枪战突击", MB_ICONWARNING);
        return 1;
    }

    WCHAR 版本[32];
    取版本号(g_目录, 版本, 32);

    WCHAR 标题[256];
    if (版本[0]) _snwprintf(标题, 255, L"枪战突击 %s", 版本);
    else lstrcpynW(标题, L"枪战突击", 256);

    写日志(L"---- 启动 %s（目录 %s）----", 标题, g_目录);

    /* 窗口类 */
    WNDCLASSEXW wc = { 0 };
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = 窗口过程;
    wc.hInstance = 实例;
    wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(16, 18, 26));
    wc.lpszClassName = L"QiangTuGameHost";
    wc.hIcon = LoadIconW(实例, MAKEINTRESOURCEW(1));
    wc.hIconSm = wc.hIcon;
    if (!RegisterClassExW(&wc)) return 2;

    /* 居中 1280x800 */
    RECT 屏; SystemParametersInfoW(SPI_GETWORKAREA, 0, &屏, 0);
    int 宽 = 1280, 高 = 800;
    int 屏宽 = 屏.right - 屏.left, 屏高 = 屏.bottom - 屏.top;
    if (宽 > 屏宽) 宽 = 屏宽;
    if (高 > 屏高) 高 = 屏高;
    int x = 屏.left + (屏宽 - 宽) / 2, y = 屏.top + (屏高 - 高) / 2;

    HWND h = CreateWindowExW(0, wc.lpszClassName, 标题,
        WS_OVERLAPPEDWINDOW,
        x, y, 宽, 高, NULL, NULL, 实例, NULL);
    if (!h) return 3;

    ShowWindow(h, SW_SHOW);
    UpdateWindow(h);

    /* 起内嵌内核；起不来就回退浏览器 */
    g_内核起来 = 网页视图_启动(h, g_目录, NULL);
    写日志(L"引擎=%s", g_内核起来 ? L"ok" : L"失败");
    if (!g_内核起来) {
        用浏览器打开();
        return 0;
    }

    MSG 消息;
    while (GetMessageW(&消息, NULL, 0, 0) > 0) {
        TranslateMessage(&消息);
        DispatchMessageW(&消息);
    }
    网页视图_关闭();
    return (int)消息.wParam;
}
