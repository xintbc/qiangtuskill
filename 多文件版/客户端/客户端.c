/* ============================================================================
   客户端.c —— 「枪战突击」桌面客户端（纯 C / Win32 + 内嵌 WebView2）
   ────────────────────────────────────────────────────────────────────────────
   它是什么：一个**纯净版、可全屏、锁定横屏**的浏览器壳，只为这一个游戏服务。
     · 直接加载本地 `多文件版/index.html`（Three.js 等全部从本机读，不联网）
     · **不调用系统浏览器**：内核以子窗口形式嵌在窗口里，没有地址栏、没有标签页、
       没有浏览器的书签/插件，任务栏里只有游戏自己
     · 顶部一条工具条：主菜单 / 刷新 / 全屏 / 帮助 / 退出
     · F11 全屏（全屏时工具条自动收起），F1 打开帮助
     · 窗口锁定 16:9 → 怎么拉都是横屏，不会被拉成竖条
   为什么要有它：手机、机房、内网这类环境里，玩家拿不到干净的浏览器，或者浏览器
   被限制、开不出 WebGL —— 这个壳把"能跑游戏的浏览器内核"和"游戏本体"打包在一起，
   双击就能玩；多人还是走同一个服务端。
   ========================================================================= */
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <commctrl.h>
#include <objbase.h>
#include <shellapi.h>
#include <stdio.h>
#include <string.h>

#include "网页视图.h"

#define 游戏服务端口 8765
#define 工具条高     36
#define 窗口标题     L"枪战突击"

#define IDC_主菜单 3001
#define IDC_刷新   3002
#define IDC_全屏   3003
#define IDC_帮助   3004
#define IDC_退出   3005
#define IDC_帮助文本 3010
#define IDC_帮助关闭 3011
#define 热键_全屏  1
#define 热键_帮助  2

static HWND  g_窗口 = NULL;
static HWND  g_按钮[5] = { 0 };
static HWND  g_帮助 = NULL;
static HFONT g_字体 = NULL;
static HBRUSH g_深色 = NULL;
static WCHAR g_根目录[MAX_PATH * 2] = { 0 };
static BOOL  g_全屏 = FALSE;
static WINDOWPLACEMENT g_原位置 = { sizeof(WINDOWPLACEMENT) };

/* --------------------------------------------------------------- 路径工具 */

static void 取目录(const WCHAR *完整路径, WCHAR *输出, int 容量)
{
    lstrcpynW(输出, 完整路径, 容量);
    WCHAR *斜 = wcsrchr(输出, L'\\');
    if (斜) *斜 = 0;
}

static int 文件在(const WCHAR *路径)
{
    DWORD a = GetFileAttributesW(路径);
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

/* 根目录＝游戏文件那一层。候选顺序：
   ① exe 旁边的「游戏」文件夹（客户端自带的拷贝 —— 发给朋友时只要这个文件夹＋exe，
      不用把整个多文件版 / 服务器目录一起拖走；batch226 用户要求：服务器和客户端不共用文件）
   ② exe 在 <多文件版>\客户端\ 里 → 看上一层（老布局，开发机用）
   ③ exe 直接丢在"多文件版"和 index.html 并排 / 再上一层。 */
static BOOL 找根目录(void)
{
    WCHAR exe[MAX_PATH * 2] = { 0 }, 目录[MAX_PATH * 2] = { 0 }, 试[MAX_PATH * 2] = { 0 };
    GetModuleFileNameW(NULL, exe, MAX_PATH * 2);
    取目录(exe, 目录, MAX_PATH * 2);

    const WCHAR *带文件[] = { L"%s\\游戏\\index.html", L"%s\\..\\index.html", L"%s\\index.html", L"%s\\..\\..\\index.html" };
    const WCHAR *带目录[] = { L"%s\\游戏", L"%s\\..", L"%s", L"%s\\..\\.." };
    for (int i = 0; i < 4; i++) {
        _snwprintf(试, MAX_PATH * 2 - 1, 带文件[i], 目录);
        if (文件在(试)) {
            WCHAR 全[MAX_PATH * 2] = { 0 };
            _snwprintf(g_根目录, MAX_PATH * 2 - 1, 带目录[i], 目录);
            if (GetFullPathNameW(g_根目录, MAX_PATH * 2, 全, NULL)) lstrcpynW(g_根目录, 全, MAX_PATH * 2);
            return TRUE;
        }
    }
    return FALSE;
}

/* 本机有没有游戏服务器在跑（决定要不要把地址预填给游戏） */
static int 探测端口(int 端口)
{
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return 0;
    struct sockaddr_in a;
    memset(&a, 0, sizeof(a));
    a.sin_family = AF_INET;
    a.sin_port = htons((u_short)端口);
    a.sin_addr.s_addr = inet_addr("127.0.0.1");
    u_long 非阻塞 = 1;
    ioctlsocket(s, FIONBIO, &非阻塞);
    int 结果 = 0;
    if (connect(s, (struct sockaddr *)&a, sizeof(a)) == 0) 结果 = 1;
    else if (WSAGetLastError() == WSAEWOULDBLOCK) {
        fd_set 写集, 错集;
        FD_ZERO(&写集); FD_SET(s, &写集);
        FD_ZERO(&错集); FD_SET(s, &错集);
        struct timeval tv; tv.tv_sec = 0; tv.tv_usec = 250000;
        if (select(0, NULL, &写集, &错集, &tv) > 0 && FD_ISSET(s, &写集)) 结果 = 1;
    }
    closesocket(s);
    return 结果;
}

/* ------------------------------------------------------------------ 布局 */

/* ------------------------------------------------ 悬浮工具条（不占画面）
   用户要求：主菜单/刷新/全屏/帮助/退出 **不要挡住游戏画面**。
   做法：网页铺满整个客户区（一点不缩），按钮是浮在它上面的子窗口，
         平时全部隐藏；鼠标移到窗口最顶上那一条（热区）才浮出来。
   这样玩游戏时画面上不会长着一条工具栏，但又随时能点到。 */
static BOOL g_工具条可见 = FALSE;

static void 工具条显示(BOOL 显示)
{
    if (显示 == g_工具条可见) return;
    g_工具条可见 = 显示;
    for (int i = 0; i < 5; i++) {
        if (!g_按钮[i]) continue;
        ShowWindow(g_按钮[i], 显示 ? SW_SHOW : SW_HIDE);
        if (显示) SetWindowPos(g_按钮[i], HWND_TOP, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}

static void 布局(HWND h)
{
    RECT rc;
    GetClientRect(h, &rc);

    int x = 8;
    int 宽们[5] = { 92, 72, 92, 92, 64 };
    for (int i = 0; i < 5; i++) {
        if (!g_按钮[i]) continue;
        MoveWindow(g_按钮[i], x, 6, 宽们[i], 24, TRUE);
        x += 宽们[i] + 6;
    }
    /* 网页永远铺满整个客户区 —— 工具条浮在上面，不参与布局 */
    网页视图_设区域(0, 0, rc.right, rc.bottom);
    if (g_工具条可见) {
        for (int i = 0; i < 5; i++) if (g_按钮[i])
            SetWindowPos(g_按钮[i], HWND_TOP, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}

/* 鼠标在"顶部热区"或者正停在按钮上 → 露出工具条；否则收起 */
static void 检查工具条(HWND h)
{
    POINT pt;
    if (!GetCursorPos(&pt)) return;
    RECT wr;
    GetWindowRect(h, &wr);

    BOOL 该显示 = FALSE;
    if (pt.x >= wr.left && pt.x <= wr.right) {
        int 距顶 = pt.y - wr.top;
        if (距顶 >= -2 && 距顶 <= 工具条高 + 6) 该显示 = TRUE;      /* 顶部热区 */
    }
    /* 鼠标正压在某个按钮上（点的时候别让它消失） */
    for (int i = 0; i < 5 && !该显示; i++) {
        if (!g_按钮[i]) continue;
        RECT br; GetWindowRect(g_按钮[i], &br);
        if (pt.x >= br.left && pt.x <= br.right && pt.y >= br.top && pt.y <= br.bottom && g_工具条可见)
            该显示 = TRUE;
    }
    工具条显示(该显示);
}

/* --------------------------------------------------------------- 全屏切换 */

static void 切全屏(HWND h)
{
    if (!g_全屏) {
        GetWindowPlacement(h, &g_原位置);
        MONITORINFO mi; mi.cbSize = sizeof(mi);
        GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTOPRIMARY), &mi);
        SetWindowLongPtrW(h, GWL_STYLE, WS_POPUP | WS_VISIBLE);
        SetWindowPos(h, HWND_TOP, mi.rcMonitor.left, mi.rcMonitor.top,
            mi.rcMonitor.right - mi.rcMonitor.left, mi.rcMonitor.bottom - mi.rcMonitor.top,
            SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        g_全屏 = TRUE;
        if (g_按钮[2]) SetWindowTextW(g_按钮[2], L"还原窗口");
    } else {
        SetWindowLongPtrW(h, GWL_STYLE, WS_OVERLAPPEDWINDOW | WS_VISIBLE);
        SetWindowPlacement(h, &g_原位置);
        SetWindowPos(h, NULL, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        g_全屏 = FALSE;
        if (g_按钮[2]) SetWindowTextW(g_按钮[2], L"全屏 F11");
    }
    布局(h);
}

/* --------------------------------------------------------------- 帮助窗口 */

static const WCHAR *帮助正文 =
    L"《枪战突击》桌面客户端 —— 帮助\r\n"
    L"\r\n"
    L"一、这是个什么东西\r\n"
    L"  一个只服务这款游戏的浏览器壳：内核嵌在窗口里，没有地址栏、没有标签页，\r\n"
    L"  不调用你系统里的浏览器。游戏本体（含 Three.js）全部从本机读取，\r\n"
    L"  断网也能玩单人。\r\n"
    L"\r\n"
    L"二、单人 / 多人\r\n"
    L"  主菜单最上面有一条「连接服务器」：\r\n"
    L"    · 填了地址点「连接」     → 进多人对战\r\n"
    L"    · 不填，或点「离线玩单人」→ 离线模式，单人 / 剧情都能玩，不能联机\r\n"
    L"  连不上时会一直提示：可以反复点「连接」重试，或者点「离线玩单人」。\r\n"
    L"  本机开服务器：双击「多文件版\\启动游戏服务器.bat」，地址填 127.0.0.1:8765 。\r\n"
    L"  客户端启动时如果发现本机已经在跑服务器，会自动把地址填好。\r\n"
    L"\r\n"
    L"三、操作（电脑）\r\n"
    L"  WASD 移动    Space 跳     左键 射击    右键 开镜\r\n"
    L"  R 换弹       双击 W 冲刺   Shift 蹲     滚轮 / 1 / 2 换武器\r\n"
    L"  V / B / N 英雄技能    Q / E 左右探头    F 抓梯攀爬\r\n"
    L"  Esc 暂停 / 菜单\r\n"
    L"\r\n"
    L"四、窗口\r\n"
    L"  F11 全屏（全屏后顶部工具条自动收起）\r\n"
    L"  F1 打开这个帮助\r\n"
    L"  窗口比例锁定 16:9 —— 怎么拉都是横屏\r\n"
    L"\r\n"
    L"五、存档与清理\r\n"
    L"  存档在本客户端自己目录下的「配置\\网页数据」里。\r\n"
    L"  删掉这个文件夹＝清空本机存档（金币、皮肤、名字、模组都在里面）。\r\n"
    L"  （金币、皮肤、登录天数、名字与身份码都在里面）。\r\n"
    L"\r\n"
    L"六、出问题了\r\n"
    L"  · 白屏 / 一直转圈：点工具条「刷新」。还不行就确认 index.html 还在。\r\n"
    L"  · 提示缺 WebView2 运行时：Win10/11 一般自带；装一次 Edge 就会有。\r\n"
    L"  · 联机连不上：先确认服务器那台电脑的窗口还开着，防火墙放通 8765。\r\n";

static LRESULT CALLBACK 帮助过程(HWND h, UINT m, WPARAM w, LPARAM l)
{
    switch (m) {
    case WM_CREATE: {
        HWND ed = CreateWindowExW(0, L"EDIT", 帮助正文,
            WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL,
            14, 12, 664, 470, h, (HMENU)IDC_帮助文本, NULL, NULL);
        if (ed && g_字体) SendMessageW(ed, WM_SETFONT, (WPARAM)g_字体, TRUE);
        CreateWindowW(L"BUTTON", L"知道了", WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON,
            300, 496, 100, 30, h, (HMENU)IDC_帮助关闭, NULL, NULL);
        return 0;
    }
    case WM_ERASEBKGND: {
        RECT r; GetClientRect(h, &r);
        FillRect((HDC)w, &r, g_深色);
        return 1;
    }
    case WM_COMMAND:
        if (LOWORD(w) == IDC_帮助关闭) { DestroyWindow(h); return 0; }
        break;
    case WM_CLOSE:
        DestroyWindow(h);
        return 0;
    case WM_DESTROY:
        g_帮助 = NULL;
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

static void 显示帮助(HWND 父)
{
    if (g_帮助) { SetForegroundWindow(g_帮助); return; }

    static BOOL 注册过 = FALSE;
    if (!注册过) {
        WNDCLASSEXW wc;
        memset(&wc, 0, sizeof(wc));
        wc.cbSize = sizeof(wc);
        wc.lpfnWndProc = 帮助过程;
        wc.hInstance = GetModuleHandleW(NULL);
        wc.hCursor = LoadCursor(NULL, IDC_ARROW);
        wc.lpszClassName = L"GunGameHelp";
        wc.hIcon = LoadIcon(NULL, IDI_INFORMATION);
        RegisterClassExW(&wc);
        注册过 = TRUE;
    }

    RECT pr; GetWindowRect(父, &pr);
    int W = 708, H = 590;
    g_帮助 = CreateWindowExW(WS_EX_TOOLWINDOW, L"GunGameHelp", L"❓ 帮助",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
        (pr.left + pr.right - W) / 2, (pr.top + pr.bottom - H) / 2, W, H,
        父, NULL, GetModuleHandleW(NULL), NULL);
    if (g_帮助) SetForegroundWindow(g_帮助);
}

/* ------------------------------------------------------------------ 窗口 */

static LRESULT CALLBACK 窗口过程(HWND h, UINT m, WPARAM w, LPARAM l)
{
    switch (m) {
    case WM_CREATE: {
        g_深色 = CreateSolidBrush(RGB(18, 21, 28));
        g_字体 = CreateFontW(-14, 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Microsoft YaHei UI");

        const WCHAR *名字[5] = { L"主菜单", L"刷新", L"全屏 F11", L"帮助 F1", L"退出" };
        for (int i = 0; i < 5; i++) {
            g_按钮[i] = CreateWindowW(L"BUTTON", 名字[i], WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                0, 0, 90, 24, h, (HMENU)(INT_PTR)(IDC_主菜单 + i), NULL, NULL);
            if (g_按钮[i] && g_字体) SendMessageW(g_按钮[i], WM_SETFONT, (WPARAM)g_字体, TRUE);
        }

        RegisterHotKey(h, 热键_全屏, 0, VK_F11);
        RegisterHotKey(h, 热键_帮助, 0, VK_F1);
        SetTimer(h, 3, 120, NULL);           /* 每 120ms 看一次鼠标要不要露工具条 */
        g_工具条可见 = TRUE;                  /* 先当成"可见"，下面用一次假调用把它收起来 */
        工具条显示(FALSE);

        /* 探测本机服务器，有就预填地址（没有就留空＝页面自己弹连接条） */
        char 服务器[128] = { 0 };
        if (探测端口(游戏服务端口)) _snprintf(服务器, sizeof(服务器) - 1, "127.0.0.1:%d", 游戏服务端口);

        if (g_根目录[0]) {
            if (!网页视图_启动(h, g_根目录, 服务器)) {
                MessageBoxW(h,
                    L"没能启动网页内核（WebView2）。\n\n"
                    L"Windows 10/11 一般自带；如果没有，装一次 Edge 浏览器就会有。\n"
                    L"装好后再打开客户端即可。",
                    L"缺少 WebView2 运行时", MB_ICONERROR | MB_OK);
            }
        } else {
            MessageBoxW(h,
                L"没找到游戏本体。\n\n"
                L"请把「客户端」文件夹放在「多文件版」里面（和 index.html 同一层），\n"
                L"或者把「枪战突击.exe」直接放进「多文件版」文件夹。",
                L"缺少游戏文件", MB_ICONERROR | MB_OK);
        }
        布局(h);
        return 0;
    }
    case WM_SIZE:
        布局(h);
        return 0;
    case WM_TIMER:
        if (w == 3) { 检查工具条(h); 网页视图_自检日志(); }
        return 0;
    case WM_ERASEBKGND: {
        RECT r; GetClientRect(h, &r);
        FillRect((HDC)w, &r, g_深色);
        return 1;
    }
    /* 锁定 16:9：拖哪个边都保持横屏 */
    case WM_SIZING: {
        if (g_全屏) return TRUE;
        RECT *r = (RECT *)l;
        int 宽 = r->right - r->left, 高 = r->bottom - r->top;
        int 按宽算高 = (int)((double)宽 * 9.0 / 16.0);
        int 按高算宽 = (int)((double)高 * 16.0 / 9.0);
        if (按高算宽 < 640) 按高算宽 = 640;
        switch (w) {
        case WMSZ_TOP:
        case WMSZ_BOTTOM:
            r->bottom = r->top + 按宽算高;
            break;
        default:
            r->right = r->left + 按高算宽;
            break;
        }
        return TRUE;
    }
    case WM_GETMINMAXINFO: {
        MINMAXINFO *mi = (MINMAXINFO *)l;
        mi->ptMinTrackSize.x = 720;
        mi->ptMinTrackSize.y = (int)(720 * 9 / 16) + 16;
        return 0;
    }
    case WM_HOTKEY:
        if (w == 热键_全屏) 切全屏(h);
        else if (w == 热键_帮助) 显示帮助(h);
        return 0;
    case WM_COMMAND: {
        int id = LOWORD(w);
        if (id == IDC_主菜单) 网页视图_转到(L"index.html");
        else if (id == IDC_刷新) 网页视图_刷新();
        else if (id == IDC_全屏) 切全屏(h);
        else if (id == IDC_帮助) 显示帮助(h);
        else if (id == IDC_退出) DestroyWindow(h);
        return 0;
    }
    case WM_DESTROY:
        KillTimer(h, 3);
        UnregisterHotKey(h, 热键_全屏);
        UnregisterHotKey(h, 热键_帮助);
        网页视图_关闭();
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

/* ------------------------------------------------------------------ 入口 */

int WINAPI wWinMain(HINSTANCE 实例, HINSTANCE 上个, PWSTR 参数, int 显示)
{
    (void)上个; (void)参数;

    /* WebView2 是 STA 控件，进程里必须先 CoInitialize */
    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);

    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);       /* 只用来探测本机 8765，不是网页服务 */

    找根目录();

    WNDCLASSEXW wc;
    memset(&wc, 0, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = 窗口过程;
    wc.hInstance = 实例;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = NULL;
    wc.lpszClassName = L"GunGameClient";
    wc.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    RegisterClassExW(&wc);

    int 宽 = 1280, 高 = (int)(1280 * 9 / 16);
    g_窗口 = CreateWindowExW(0, L"GunGameClient", 窗口标题,
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        CW_USEDEFAULT, CW_USEDEFAULT, 宽, 高,
        NULL, NULL, 实例, NULL);
    if (!g_窗口) return 0;

    ShowWindow(g_窗口, 显示 ? 显示 : SW_SHOWNORMAL);
    UpdateWindow(g_窗口);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    WSACleanup();
    CoUninitialize();
    return 0;
}
