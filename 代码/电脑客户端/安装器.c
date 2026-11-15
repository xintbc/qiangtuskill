/* ============================================================================
   安装器.c —— 「枪战突击」电脑客户端 单文件安装程序
   ----------------------------------------------------------------------------
   一条命令式的一键安装：所有游戏文件以 RCDATA 资源内嵌在本 exe 里，
   玩家双击 → 选目录 → 装好 → 桌面出图标。不再有 zip + bat + vbs 那一套。

   为什么自己写而不用 NSIS/Inno：本机没有这些工具，而这活儿本来就不复杂——
   解资源、建目录、建快捷方式，Win32 全都能干，还顺带解决三个老问题：
     ① 安装目录让玩家自己选（默认 %LOCALAPPDATA%\枪战突击，已装过默认换个名）
        —— 第二份装到别处，WebView2 的数据目录跟着 exe 走，模组/存档天然隔离，
           再也不会"第二个客户端读出第一个的模组"（以前 bat 一律装进同一目录）
     ② 桌面快捷方式动态指向**本次**安装的目录（以前 vbs 写死 %LOCALAPPDATA%）
     ③ 装完可以直接启动，进度看得见

   资源布局（由 打包安装包.py 生成 安装器资源.rc）：
     ID 1..N        RCDATA  每个内嵌文件一份（按清单顺序编号）
     ID 900         RCDATA  清单：UTF-8 文本，每行「编号\t相对路径\t大小」
                             （相对路径统一用 / ，装的时候换成 \ ）

   卸载：安装器.exe /卸载 <目录>  （删目录 + 删桌面快捷方式）
   位数：只支持 64 位 Windows。32 位系统启动时给指引（网页版不挑位数）。
   ========================================================================= */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <shlobj.h>
#include <shellapi.h>
#include <objbase.h>
#include <commctrl.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <shobjidl.h>

#define 资源清单号   900
#define 最大文件数   2048

/* ---------------- 内嵌文件清单（内存态） ---------------- */
typedef struct {
    int  编号;
    char 相对路径[512];      /* UTF-8，用 / 分隔 */
    DWORD 大小;
} 清单项;

static 清单项 g_清单[最大文件数];
static int   g_清单数 = 0;
static BYTE *g_数据[最大文件数];       /* 指向资源内存，不用释放 */
static DWORD g_数据大[最大文件数];

/* ---------------- 向导状态 ---------------- */
static HWND  g_窗;
static HFONT g_字;
static int   g_页 = 0;                    /* 0欢迎 1选目录 2安装中 3完成 */
static WCHAR g_目录[MAX_PATH * 2] = { 0 };
static BOOL  g_建快捷方式 = TRUE;
static BOOL  g_立即启动 = TRUE;
static BOOL  g_装好了 = FALSE;
static HWND  g_进度条;
static long long g_总字节 = 0, g_已写 = 0;

static HINSTANCE g_实例;

/* ---------------------------------------------------------------- 小工具 */

/* 路径规范化：正斜杠 → 反斜杠、去掉尾部反斜杠（保留 "C:\" 这种）。
   ⚠️ 必须做：安装目录从命令行/浏览框来时可能带正斜杠（D:/xx），
   IShellLinkW::SetPath 对混合斜杠会存出坏链接（实测 GetPath 只读出 "D"，
   桌面快捷方式双击无效——用户报"创建快捷方式的方式不对"）。 */
static void 规整路径(WCHAR *路径)
{
    for (WCHAR *p = 路径; *p; p++) if (*p == L'/') *p = L'\\';
    int len = lstrlenW(路径);
    while (len > 3 && 路径[len - 1] == L'\\') 路径[--len] = 0;
}

/* 目录合法性：不能装在盘符根 / 系统目录 / Windows 目录里 */
static BOOL 目录靠谱(const WCHAR *目录, WCHAR *原因, int 原因容量)
{
    if (!目录 || !目录[0] || lstrlenW(目录) < 3) {
        lstrcpynW(原因, L"请先选一个安装目录。", 原因容量); return FALSE;
    }
    WCHAR 干[MAX_PATH * 2];
    lstrcpynW(干, 目录, MAX_PATH * 2);
    for (WCHAR *p = 干; *p; p++) if (*p == L'/') *p = L'\\';
    int len = lstrlenW(干);
    while (len > 3 && 干[len - 1] == L'\\') 干[--len] = 0;

    /* 盘符根（C:\、D:\）：装这儿太乱，玩家也容易误删 */
    if (len == 3 && 干[1] == L':') {
        lstrcpynW(原因, L"不能直接装在盘符根目录（比如 D:\\）。\n\n请选一个文件夹（不存在会自动建），比如「D:\\枪战突击」。", 原因容量);
        return FALSE;
    }
    /* 系统目录（大小写不敏感、按整段路径比：\windows、\program files…） */
    const WCHAR *禁[] = { L"\\windows", L"\\program files", L"\\program files (x86)", L"\\users", L"\\$recycle.bin" };
    for (int i = 0; i < 5; i++) {
        int n = lstrlenW(禁[i]);
        for (const WCHAR *p = 干; *p; p++) {
            if ((p == 干 || p[-1] == L'\\') && (p[n] == 0 || p[n] == L'\\')) {
                BOOL 同 = TRUE;
                for (int k = 0; k < n; k++) {
                    WCHAR a = p[k], b = 禁[i][k];
                    if (a >= L'A' && a <= L'Z') a += 32;
                    if (b >= L'A' && b <= L'Z') b += 32;
                    if (a != b) { 同 = FALSE; break; }
                }
                if (同) {
                    _snwprintf(原因, 原因容量 - 1, L"这个目录是系统目录，不能装游戏。\n\n%s", 干);
                    return FALSE;
                }
            }
        }
    }
    return TRUE;
}

static void 宽窄互转(const WCHAR *宽, char *窄, int 窄容量)
{
    WideCharToMultiByte(CP_UTF8, 0, 宽, -1, 窄, 窄容量, NULL, NULL);
}

/* 读资源到内存（返回指针，生命周期=进程，别 free）。
   ⚠️ 类型名必须是 RT_RCDATA（rc 里写的就是标准 RCDATA），不是自定义字符串 ——
      写错就 FindResource 直接失败，表现为"安装包数据损坏"。 */
static const BYTE *取资源(int 号, DWORD *大小)
{
    HRSRC r = FindResourceW(g_实例, MAKEINTRESOURCEW(号), RT_RCDATA);
    if (!r) return NULL;
    HGLOBAL h = LoadResource(g_实例, r);
    if (!h) return NULL;
    DWORD s = SizeofResource(g_实例, r);
    const BYTE *p = (const BYTE *)LockResource(h);
    if (!p || !s) return NULL;
    if (大小) *大小 = s;
    return p;
}

/* 读清单资源，解析进 g_清单 */
static BOOL 读清单(void)
{
    DWORD 大小 = 0;
    const BYTE *p = 取资源(资源清单号, &大小);
    if (!p) return FALSE;
    int i, 行起 = 0;
    for (i = 0; i <= (int)大小 && g_清单数 < 最大文件数; i++) {
        if (i == (int)大小 || p[i] == '\n') {
            int 行长 = i - 行起;
            if (行长 > 0) {
                char 行[600] = { 0 };
                int n = 行长 < 599 ? 行长 : 599;
                memcpy(行, p + 行起, n);
                /* 去掉可能的 \r */
                char *cr = strchr(行, '\r'); if (cr) *cr = 0;
                /* 编号 \t 路径 \t 大小 */
                char *t1 = strchr(行, '\t');
                if (t1) {
                    *t1 = 0;
                    char *t2 = strchr(t1 + 1, '\t');
                    if (t2) {
                        *t2 = 0;
                        清单项 *it = &g_清单[g_清单数];
                        it->编号 = atoi(行);
                        strncpy(it->相对路径, t1 + 1, sizeof(it->相对路径) - 1);
                        it->大小 = (DWORD)_atoi64(t2 + 1);
                        DWORD 实大小 = 0;
                        const BYTE *d = 取资源(it->编号, &实大小);
                        if (d) {
                            g_数据[g_清单数] = (BYTE *)d;
                            g_数据大[g_清单数] = 实大小;
                            g_清单数++;
                            g_总字节 += 实大小;
                        }
                    }
                }
            }
            行起 = i + 1;
        }
    }
    return g_清单数 > 0;
}

/* 逐级建目录 */
static void 建目录(const WCHAR *路径)
{
    WCHAR 临时[MAX_PATH * 2];
    lstrcpynW(临时, 路径, MAX_PATH * 2);
    for (WCHAR *p = 临时 + 3; *p; p++) {
        if (*p == L'\\') { *p = 0; CreateDirectoryW(临时, NULL); *p = L'\\'; }
    }
    CreateDirectoryW(临时, NULL);
}

/* 把一个清单项写到目标目录 */
static BOOL 写文件(int 序号, const WCHAR *目标目录)
{
    char 相对[512];
    lstrcpynA(相对, g_清单[序号].相对路径, 512);
    for (char *s = 相对; *s; s++) if (*s == '/') *s = '\\';

    WCHAR 宽相对[MAX_PATH] = { 0 };
    MultiByteToWideChar(CP_UTF8, 0, 相对, -1, 宽相对, MAX_PATH);
    WCHAR 全路径[MAX_PATH * 2];
    _snwprintf(全路径, MAX_PATH * 2 - 1, L"%s\\%s", 目标目录, 宽相对);

    /* 先建父目录 */
    WCHAR 父[MAX_PATH * 2];
    lstrcpynW(父, 全路径, MAX_PATH * 2);
    WCHAR *斜 = wcsrchr(父, L'\\');
    if (斜) { *斜 = 0; 建目录(父); }

    HANDLE f = CreateFileW(全路径, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) {
        /* 【1.9.55】被占用（旧客户端还没退干净 / 杀毒软件正在扫 / 开了两个实例）：
           先把旧文件改名让路，再写新的。Windows 允许给「正在运行的程序」改名，
           但不允许覆盖它 —— 这一步决定客户端内升级能不能真的装上去。 */
        WCHAR 旧名[MAX_PATH * 2];
        _snwprintf(旧名, MAX_PATH * 2 - 1, L"%s.old", 全路径);
        DeleteFileW(旧名);
        if (MoveFileW(全路径, 旧名)) {
            f = CreateFileW(全路径, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                FILE_ATTRIBUTE_NORMAL, NULL);
        }
    }
    if (f == INVALID_HANDLE_VALUE) return FALSE;
    DWORD 写 = 0;
    BOOL ok = WriteFile(f, g_数据[序号], g_数据大[序号], &写, NULL);
    CloseHandle(f);
    if (ok) g_已写 += g_数据大[序号];
    return ok;
}

/* 建快捷方式（桌面 + 开始菜单都建），路径动态指向本次安装目录。
   ⚠️ SetPath 前必须规整路径：混合斜杠会存出坏链接（GetPath 只读出盘符）。 */
static BOOL 建快捷方式于(const WCHAR *目录, const WCHAR *lnk全路径)
{
    WCHAR 目标exe[MAX_PATH * 2];
    _snwprintf(目标exe, MAX_PATH * 2 - 1, L"%s\\枪战客户端.exe", 目录);

    IShellLinkW *link = NULL;
    HRESULT hrCo = CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER,
            &IID_IShellLinkW, (void **)&link);
    if (!SUCCEEDED(hrCo)) return FALSE;
    link->lpVtbl->SetPath(link, 目标exe);
    link->lpVtbl->SetWorkingDirectory(link, 目录);
    link->lpVtbl->SetIconLocation(link, 目标exe, 0);
    link->lpVtbl->SetDescription(link, L"枪战突击 · 电脑客户端");

    IPersistFile *pf = NULL;
    BOOL ok = FALSE;
    if (SUCCEEDED(link->lpVtbl->QueryInterface(link, &IID_IPersistFile, (void **)&pf))) {
        HRESULT hrSave = pf->lpVtbl->Save(pf, lnk全路径, TRUE);
        ok = SUCCEEDED(hrSave);
        pf->lpVtbl->Release(pf);
    }
    link->lpVtbl->Release(link);
    return ok;
}

static BOOL 建全部快捷方式(const WCHAR *安装目录)
{
    BOOL 桌 = FALSE, 菜 = FALSE;
    WCHAR 桌面[MAX_PATH * 2] = { 0 };
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, 桌面))) {
        WCHAR lnk[MAX_PATH * 2];
        _snwprintf(lnk, MAX_PATH * 2 - 1, L"%s\\枪战突击.lnk", 桌面);
        /* 【1.9.49 修】以前写的是"桌面上已有同名快捷方式就不覆盖"——
           结果玩家换目录重装后，桌面图标还指着**旧位置**：点了打不开、或者进了旧版本，
           看起来就是"没给我建快捷方式"。现在每次安装都重建，保证指向本次安装的目录。 */
        桌 = 建快捷方式于(安装目录, lnk);
    }
    WCHAR 菜单[MAX_PATH * 2] = { 0 };
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, 0, 菜单))) {
        WCHAR 目录[MAX_PATH * 2], lnk[MAX_PATH * 2];
        _snwprintf(目录, MAX_PATH * 2 - 1, L"%s\\枪战突击", 菜单);
        建目录(目录);
        _snwprintf(lnk, MAX_PATH * 2 - 1, L"%s\\枪战突击.lnk", 目录);
        菜 = 建快捷方式于(安装目录, lnk);
        /* 开始菜单里再放一个卸载入口 */
        WCHAR 卸[MAX_PATH * 2];
        _snwprintf(卸, MAX_PATH * 2 - 1, L"%s\\卸载 枪战突击.lnk", 目录);
        WCHAR 自己[MAX_PATH * 2] = { 0 };
        GetModuleFileNameW(NULL, 自己, MAX_PATH * 2);
        if (自己[0]) {
            IShellLinkW *link = NULL;
            if (SUCCEEDED(CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER,
                    &IID_IShellLinkW, (void **)&link))) {
                link->lpVtbl->SetPath(link, 自己);
                WCHAR 参数行[MAX_PATH * 2];
                _snwprintf(参数行, MAX_PATH * 2 - 1, L"/卸载 \"%s\"", 安装目录);
                link->lpVtbl->SetArguments(link, 参数行);
                link->lpVtbl->SetDescription(link, L"卸载《枪战突击》电脑客户端");
                IPersistFile *pf = NULL;
                if (SUCCEEDED(link->lpVtbl->QueryInterface(link, &IID_IPersistFile, (void **)&pf))) {
                    pf->lpVtbl->Save(pf, 卸, TRUE);
                    pf->lpVtbl->Release(pf);
                }
                link->lpVtbl->Release(link);
            }
        }
    }
    return 桌 || 菜;
}

/* ---------------------------------------------------------------- 界面 */

#define 钮宽 96
static HFONT 建字体(void)
{
    return CreateFontW(-15, 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
        DEFAULT_PITCH, L"Microsoft YaHei UI");
}

static HWND 加按钮(const WCHAR *文, int id, int x, int y, int w, int h)
{
    HWND b = CreateWindowW(L"BUTTON", 文, WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
        x, y, w, h, g_窗, (HMENU)(INT_PTR)id, g_实例, NULL);
    if (b) SendMessageW(b, WM_SETFONT, (WPARAM)g_字, TRUE);
    return b;
}

static HWND 加静态(const WCHAR *文, int x, int y, int w, int h)
{
    HWND s = CreateWindowW(L"STATIC", 文, WS_CHILD | WS_VISIBLE,
        x, y, w, h, g_窗, NULL, g_实例, NULL);
    if (s) SendMessageW(s, WM_SETFONT, (WPARAM)g_字, TRUE);
    return s;
}

static HWND g_页0控件[4], g_页1控件[8], g_页2控件[3], g_页3控件[6];
static HWND g_目录框, g_浏览钮, g_进度文字, g_版本行;

static void 刷新版本提示(void);      /* 定义在后面（版本检测那一段） */

/* ============================================================================
   【1.9.49】界面重做：全自绘深色风格
   ----------------------------------------------------------------------------
   原来那套是系统默认控件（灰底 + 系统按钮 + 细边框），在 Win11 上看着像十几年前
   的工具。现在改成和「开服器安装程序」同一套设计语言：
     · 深色渐变背景 + 淡淡的点阵
     · 圆角图标容器、大标题、细分隔线
     · 自绘圆角按钮（主按钮带上下渐变）
     · 自绘进度条（带高光）、自绘大对勾
   逻辑一行没动 —— 只是把「画」和「点」重写了；按钮点击仍然发 WM_COMMAND，
   走原来那套 id（1002/1003/2002/2003/4003），所以解包/版本检测/快捷方式全照旧。
   ========================================================================= */
static BOOL 读内嵌文本(const char *相对路径, WCHAR *出, int 容量);

#define C_BG      RGB(0x08, 0x0D, 0x18)
#define C_HEAD1   RGB(0x1A, 0x2A, 0x45)
#define C_CARD    RGB(0x0F, 0x18, 0x28)
#define C_FIELD   RGB(0x0C, 0x15, 0x24)
#define C_LINE    RGB(0x1C, 0x2A, 0x40)
#define C_LINE_HI RGB(0x27, 0x3A, 0x58)
#define C_TEXT    RGB(0xEA, 0xF2, 0xFF)
#define C_DIM     RGB(0x6E, 0x84, 0xA8)
#define C_DIM2    RGB(0x4A, 0x5C, 0x7A)
#define C_MAIN    RGB(0x2F, 0x7B, 0xFF)
#define C_MAIN_HI RGB(0x5B, 0x9C, 0xFF)
#define C_MAIN_DK RGB(0x1F, 0x5C, 0xD8)
#define C_OK      RGB(0x3D, 0xDC, 0x97)
#define C_OK_DK   RGB(0x14, 0x3D, 0x30)

static int g_dpi = 96;
#define S2(v) MulDiv((v), g_dpi, 96)

static WCHAR g_版本文[640] = { 0 };    /* 版本提示那一大段（原来是 STATIC 控件） */
static WCHAR g_进度文[300] = { 0 };    /* 当前正在写的文件名 */
static int   g_进度百 = 0;             /* 0..100 */
static int   g_悬停 = -1;
static HBRUSH g_框刷 = NULL;

typedef struct { RECT r; const wchar_t *t; int id; int 主; } 钮;
static 钮 g_钮[4];
static int g_钮数 = 0;

static HFONT 造字(int px, int 粗)
{
    return CreateFontW(-S2(px), 0, 0, 0, 粗 ? FW_BOLD : FW_NORMAL, 0, 0, 0,
        DEFAULT_CHARSET, OUT_TT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
        DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
}

static void 写(HDC dc, const wchar_t *s, int x, int y, int w, int h,
    int px, int 粗, COLORREF c, UINT f)
{
    HFONT ft; HGDIOBJ of; RECT r;
    if (!s || !s[0]) return;
    ft = 造字(px, 粗);
    of = SelectObject(dc, ft);
    r.left = x; r.top = y; r.right = x + w; r.bottom = y + h;
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, c);
    DrawTextW(dc, s, -1, &r, f);
    SelectObject(dc, of);
    DeleteObject(ft);
}

static void 圆角(HDC dc, int x, int y, int w, int h, int rad,
    COLORREF 填, COLORREF 线, int 线宽)
{
    HBRUSH br = CreateSolidBrush(填);
    HPEN pn = CreatePen(PS_SOLID, 线宽, 线);
    HGDIOBJ ob = SelectObject(dc, br), op = SelectObject(dc, pn);
    if (rad > 0) RoundRect(dc, x, y, x + w, y + h, rad, rad);
    else Rectangle(dc, x, y, x + w, y + h);
    SelectObject(dc, ob); SelectObject(dc, op);
    DeleteObject(br); DeleteObject(pn);
}

static void 渐变(HDC dc, int x, int y, int w, int h, COLORREF a, COLORREF b)
{
    int i;
    for (i = 0; i < h; i++) {
        int t = (h > 1) ? (i * 255 / (h - 1)) : 0;
        int r = GetRValue(a) + (GetRValue(b) - GetRValue(a)) * t / 255;
        int g = GetGValue(a) + (GetGValue(b) - GetGValue(a)) * t / 255;
        int bl = GetBValue(a) + (GetBValue(b) - GetBValue(a)) * t / 255;
        HPEN pn = CreatePen(PS_SOLID, 1, RGB(r, g, bl));
        HGDIOBJ op = SelectObject(dc, pn);
        MoveToEx(dc, x, y + i, NULL);
        LineTo(dc, x + w, y + i);
        SelectObject(dc, op);
        DeleteObject(pn);
    }
}

static void 圆角渐变(HDC dc, int x, int y, int w, int h, int rad,
    COLORREF a, COLORREF b)
{
    HRGN rg;
    if (w <= 0 || h <= 0) return;
    rg = CreateRoundRectRgn(x, y, x + w + 1, y + h + 1, rad, rad);
    SelectClipRgn(dc, rg);
    渐变(dc, x, y, w, h, a, b);
    SelectClipRgn(dc, NULL);
    DeleteObject(rg);
}

static void 点阵(HDC dc, int w, int h, int 起Y)
{
    int x, y, 步 = S2(26);
    COLORREF dot = RGB(0x14, 0x1F, 0x31);
    for (y = 起Y; y < h - S2(4); y += 步)
        for (x = S2(26); x < w - S2(4); x += 步)
            SetPixel(dc, x, y, dot);
}

static void 大勾(HDC dc, int cx, int cy, int r)
{
    int i;
    for (i = 0; i < S2(10); i++) {
        int rr = r + S2(10) - i;
        int t = i * 255 / (S2(10) > 1 ? S2(10) - 1 : 1);
        int g = 0x14 + (0x3D - 0x14) * t / 255;
        int bl = 0x20 + (0x30 - 0x20) * t / 255;
        HBRUSH br = CreateSolidBrush(RGB(0x0A, g, bl));
        HPEN pn = CreatePen(PS_NULL, 0, RGB(0, 0, 0));
        HGDIOBJ ob = SelectObject(dc, br), op = SelectObject(dc, pn);
        Ellipse(dc, cx - rr, cy - rr, cx + rr, cy + rr);
        SelectObject(dc, ob); SelectObject(dc, op);
        DeleteObject(br); DeleteObject(pn);
    }
    {
        HBRUSH br = CreateSolidBrush(C_OK_DK);
        HPEN pn = CreatePen(PS_SOLID, S2(2), C_OK);
        HGDIOBJ ob = SelectObject(dc, br), op = SelectObject(dc, pn);
        Ellipse(dc, cx - r, cy - r, cx + r, cy + r);
        SelectObject(dc, ob); SelectObject(dc, op);
        DeleteObject(br); DeleteObject(pn);
    }
    {
        HPEN pn = CreatePen(PS_SOLID, S2(4), C_OK);
        HGDIOBJ op = SelectObject(dc, pn);
        MoveToEx(dc, cx - r * 4 / 10, cy + r * 1 / 10, NULL);
        LineTo(dc, cx - r / 10, cy + r * 4 / 10);
        LineTo(dc, cx + r * 5 / 10, cy - r * 3 / 10);
        SelectObject(dc, op);
        DeleteObject(pn);
    }
}

static void 勾选行(HDC dc, int x, int y, int on, const wchar_t *文)
{
    int sz = S2(20);
    圆角(dc, x, y, sz, sz, S2(6), on ? C_MAIN : C_FIELD, on ? C_MAIN : C_LINE, 1);
    if (on) {
        HPEN pn = CreatePen(PS_SOLID, S2(2), RGB(255, 255, 255));
        HGDIOBJ op = SelectObject(dc, pn);
        MoveToEx(dc, x + sz / 5, y + sz / 2, NULL);
        LineTo(dc, x + sz * 4 / 10, y + sz * 7 / 10);
        LineTo(dc, x + sz * 4 / 5, y + sz / 4);
        SelectObject(dc, op);
        DeleteObject(pn);
    }
    写(dc, 文, x + sz + S2(12), y - S2(3), S2(340), sz + S2(6), 13, 0, C_TEXT,
        DT_LEFT | DT_SINGLELINE | DT_VCENTER);
}

/* 按当前页排按钮（和开服器安装程序同一套坐标） */
static void 排钮(void)
{
    RECT rc;
    int bh = S2(44), y;
    GetClientRect(g_窗, &rc);
    y = rc.bottom - S2(70);
    g_钮数 = 0;

    if (g_页 == 0) {
        int w1 = S2(140), w2 = S2(96), x = rc.right - S2(32) - w1;
        g_钮[g_钮数].r.left = x;               g_钮[g_钮数].r.top = y;
        g_钮[g_钮数].r.right = x + w1;         g_钮[g_钮数].r.bottom = y + bh;
        g_钮[g_钮数].t = L"开始安装"; g_钮[g_钮数].id = 2003; g_钮[g_钮数].主 = 1;
        g_钮数++;

        x -= S2(12) + w2;
        g_钮[g_钮数].r.left = x;               g_钮[g_钮数].r.top = y;
        g_钮[g_钮数].r.right = x + w2;         g_钮[g_钮数].r.bottom = y + bh;
        g_钮[g_钮数].t = L"取消"; g_钮[g_钮数].id = 1003; g_钮[g_钮数].主 = 0;
        g_钮数++;

        /* 浏览…：贴在路径框右边 */
        g_钮[g_钮数].r.left = S2(556);         g_钮[g_钮数].r.top = S2(178);
        g_钮[g_钮数].r.right = S2(688);        g_钮[g_钮数].r.bottom = S2(234);
        g_钮[g_钮数].t = L"浏览…"; g_钮[g_钮数].id = 2002; g_钮[g_钮数].主 = 0;
        g_钮数++;
    } else if (g_页 == 2) {
        int w1 = S2(140), x = rc.right - S2(32) - w1;
        g_钮[g_钮数].r.left = x;               g_钮[g_钮数].r.top = y;
        g_钮[g_钮数].r.right = x + w1;         g_钮[g_钮数].r.bottom = y + bh;
        g_钮[g_钮数].t = L"完成"; g_钮[g_钮数].id = 4003; g_钮[g_钮数].主 = 1;
        g_钮数++;
    }
}

static void 画钮(HDC dc, 钮 *b, int 热)
{
    int w = b->r.right - b->r.left, h = b->r.bottom - b->r.top;
    if (b->主) {
        COLORREF 上 = 热 ? RGB(0x6F, 0xAB, 0xFF) : C_MAIN_HI;
        COLORREF 下 = 热 ? C_MAIN_HI : C_MAIN_DK;
        圆角渐变(dc, b->r.left, b->r.top, w, h, S2(10), 上, 下);
        写(dc, b->t, b->r.left, b->r.top, w, h, 14, 1, RGB(255, 255, 255),
            DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    } else {
        COLORREF 底 = 热 ? RGB(0x17, 0x24, 0x39) : C_CARD;
        COLORREF 线 = 热 ? C_LINE_HI : C_LINE;
        圆角(dc, b->r.left, b->r.top, w, h, S2(10), 底, 线, 1);
        写(dc, b->t, b->r.left, b->r.top, w, h, 14, 0,
            热 ? C_TEXT : RGB(0xB4, 0xC6, 0xE0),
            DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    }
}

/* 整窗重绘 */
static void 画全(HDC dc, int w, int h)
{
    int i, 底Y = h - S2(70);

    渐变(dc, 0, 0, w, h, C_HEAD1, C_BG);
    点阵(dc, w, h, S2(126));

    /* ---------- 头部 ---------- */
    {
        int ic = S2(76), ix = S2(34), iy = S2(26);
        圆角(dc, ix - S2(6), iy - S2(6), ic + S2(12), ic + S2(12), S2(18),
            RGB(0x0E, 0x18, 0x2A), C_LINE_HI, 1);
        {
            HICON hi = (HICON)LoadImageW(g_实例, MAKEINTRESOURCEW(1000), IMAGE_ICON,
                ic, ic, LR_DEFAULTCOLOR);
            if (hi) { DrawIconEx(dc, ix, iy, hi, ic, ic, 0, NULL, DI_NORMAL); DestroyIcon(hi); }
            else 圆角(dc, ix, iy, ic, ic, S2(14), C_MAIN, C_MAIN, 1);
        }
        写(dc, L"枪战突击 · 电脑客户端", ix + ic + S2(22), iy - S2(2), w - S2(320), S2(36),
            23, 1, C_TEXT, DT_LEFT | DT_SINGLELINE | DT_VCENTER);
        写(dc, L"单文件安装  ·  不联网  ·  存档与模组独立", ix + ic + S2(23), iy + S2(38),
            w - S2(320), S2(24), 12.5, 0, C_DIM, DT_LEFT | DT_SINGLELINE | DT_VCENTER);
    }
    /* 右上角版本 */
    {
        WCHAR 本[32] = { 0 }, 行[64];
        读内嵌文本("版本.txt", 本, 32);
        if (本[0]) { _snwprintf(行, 63, L"v%s", 本); } else lstrcpynW(行, L"", 64);
        if (行[0])
            写(dc, 行, w - S2(160), S2(44), S2(128), S2(22), 12, 0, C_DIM2,
                DT_RIGHT | DT_SINGLELINE | DT_VCENTER);
    }
    /* 分隔线 + 一段高光 */
    {
        HPEN pn = CreatePen(PS_SOLID, 1, C_LINE);
        HGDIOBJ op = SelectObject(dc, pn);
        MoveToEx(dc, 0, S2(124), NULL); LineTo(dc, w, S2(124));
        SelectObject(dc, op); DeleteObject(pn);
        {
            HPEN p2 = CreatePen(PS_SOLID, 1, RGB(0x25, 0x44, 0x78));
            HGDIOBJ o2 = SelectObject(dc, p2);
            MoveToEx(dc, S2(34), S2(124), NULL); LineTo(dc, S2(214), S2(124));
            SelectObject(dc, o2); DeleteObject(p2);
        }
    }

    /* ---------- 内容 ---------- */
    if (g_页 == 0) {
        写(dc, L"装到哪个目录？", S2(40), S2(142), S2(400), S2(26), 14, 1, C_TEXT,
            DT_LEFT | DT_SINGLELINE | DT_VCENTER);
        /* 路径框底（EDIT 盖在上面） */
        圆角(dc, S2(40), S2(178), S2(500), S2(56), S2(10), C_FIELD, C_LINE, 1);

        /* 版本检测结果：卡片显示，多行 */
        if (g_版本文[0]) {
            圆角(dc, S2(40), S2(256), w - S2(72), S2(96), S2(10), C_CARD, C_LINE, 1);
            写(dc, g_版本文, S2(58), S2(268), w - S2(110), S2(76), 12.5, 0, C_DIM,
                DT_LEFT | DT_TOP | DT_WORDBREAK);
        }
        勾选行(dc, S2(40), S2(378), g_建快捷方式, L"创建桌面快捷方式");
    } else if (g_页 == 1) {
        WCHAR pc[16];
        _snwprintf(pc, 15, L"%d%%", g_进度百);
        写(dc, L"正在安装", S2(40), S2(146), S2(300), S2(26), 14, 1, C_DIM,
            DT_LEFT | DT_SINGLELINE | DT_VCENTER);
        写(dc, pc, S2(40), S2(172), S2(300), S2(52), 40, 1, C_TEXT,
            DT_LEFT | DT_SINGLELINE | DT_VCENTER);
        {
            int bw = w - S2(80), bx = S2(40), by = S2(248), bh2 = S2(14);
            圆角(dc, bx, by, bw, bh2, S2(7), RGB(0x13, 0x1E, 0x30), RGB(0x13, 0x1E, 0x30), 1);
            if (g_进度百 > 0) {
                int fw = bw * g_进度百 / 100;
                if (fw < S2(14)) fw = S2(14);
                圆角渐变(dc, bx, by, fw, bh2, S2(7), C_MAIN_HI, C_MAIN);
                {
                    HRGN rg = CreateRoundRectRgn(bx, by, bx + fw + 1, by + bh2 + 1, S2(7), S2(7));
                    SelectClipRgn(dc, rg);
                    {
                        HPEN pn = CreatePen(PS_SOLID, 1, RGB(0x8C, 0xBC, 0xFF));
                        HGDIOBJ op = SelectObject(dc, pn);
                        MoveToEx(dc, bx, by + S2(3), NULL); LineTo(dc, bx + fw, by + S2(3));
                        SelectObject(dc, op); DeleteObject(pn);
                    }
                    SelectClipRgn(dc, NULL); DeleteObject(rg);
                }
            }
        }
        写(dc, g_进度文, S2(40), S2(280), w - S2(80), S2(24), 12.5, 0, C_DIM,
            DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
        写(dc, L"几秒钟就好，别关窗口。", S2(40), S2(316), w - S2(80), S2(24), 12.5, 0, C_DIM2,
            DT_LEFT | DT_SINGLELINE | DT_VCENTER);
    } else {
        大勾(dc, S2(84), S2(206), S2(36));
        写(dc, L"装好了！", S2(140), S2(178), S2(400), S2(40), 26, 1, C_OK,
            DT_LEFT | DT_SINGLELINE | DT_VCENTER);
        写(dc, L"桌面会有「枪战突击」图标，双击就能进游戏", S2(140), S2(222),
            w - S2(180), S2(24), 13, 0, C_TEXT, DT_LEFT | DT_SINGLELINE | DT_VCENTER);
        圆角(dc, S2(40), S2(272), w - S2(72), S2(52), S2(10), RGB(0x0D, 0x17, 0x27), C_LINE, 1);
        写(dc, L"模组在游戏里装（设置 → 模组管理）；卸载＝删掉安装目录和桌面图标",
            S2(58), S2(272), w - S2(106), S2(52), 12.5, 0, C_DIM,
            DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
        勾选行(dc, S2(40), S2(348), g_立即启动, L"立即启动游戏");
    }

    /* ---------- 底部 ---------- */
    {
        HPEN pn = CreatePen(PS_SOLID, 1, C_LINE);
        HGDIOBJ op = SelectObject(dc, pn);
        MoveToEx(dc, 0, 底Y - S2(16), NULL); LineTo(dc, w, 底Y - S2(16));
        SelectObject(dc, op); DeleteObject(pn);
        写(dc, L"从内嵌资源解压安装  ·  不联网、不上传任何数据", S2(36), 底Y + S2(10),
            S2(400), S2(24), 11.5, 0, C_DIM2, DT_LEFT | DT_SINGLELINE | DT_VCENTER);
    }

    for (i = 0; i < g_钮数; i++) 画钮(dc, &g_钮[i], g_悬停 == g_钮[i].id);
}



static void 显示页(int 页)
{
    /* 【1.9.49】页号重排：0=选目录（合并了原来的"欢迎"和"选目录"）1=安装中 2=完成。
       所有控件都自绘了，这里只负责切换状态、同步那个唯一的 EDIT、然后重绘。 */
    g_页 = 页;
    SetWindowTextW(g_窗, 页 == 2 ? L"枪战突击 · 安装完成" : L"枪战突击 · 电脑客户端 安装");
    if (g_目录框) {
        ShowWindow(g_目录框, 页 == 0 ? SW_SHOW : SW_HIDE);
        if (页 == 0)
            SetWindowPos(g_目录框, NULL, S2(56), S2(192), S2(466), S2(30),
                SWP_NOZORDER | SWP_NOACTIVATE);
    }
    排钮();
    if (页 == 0) 刷新版本提示();      /* 进选目录页就告诉玩家：这是新装还是更新 */
    if (g_窗) { InvalidateRect(g_窗, NULL, FALSE); UpdateWindow(g_窗); }
}

/* ---------------------------------------------------------------- 版本检测
   目标（用户要求）：**同一个安装目录**里如果已经装了同一个游戏但版本不同，
   就自动按「更新」处理，而且绝不碰用户数据（存档/账号/模组库/玩家自加的模组）。
   做法：
     · 安装包根目录带一个 `版本.txt`（打包时从 js/02 的 GAME_VER 生成）
     · 装好后它落在安装目录里，下次安装就能读到"已装版本"
     · 安装只写清单里的文件、从不删目录 → 配置\ 和玩家自己放进 mode\模组\ 的文件天然保留
   ---------------------------------------------------------------- */

/* 从内嵌清单里读某个文本文件的内容（这里用来读 版本.txt） */
static BOOL 读内嵌文本(const char *相对路径, WCHAR *出, int 容量)
{
    出[0] = 0;
    for (int i = 0; i < g_清单数; i++) {
        if (lstrcmpiA(g_清单[i].相对路径, 相对路径) != 0) continue;
        char 临时[64] = { 0 };
        DWORD 取 = g_数据大[i] < sizeof(临时) - 1 ? g_数据大[i] : sizeof(临时) - 1;
        memcpy(临时, g_数据[i], 取);
        /* 只取第一行、去掉空白 */
        for (DWORD k = 0; k < 取; k++) if (临时[k] == '\r' || 临时[k] == '\n') { 临时[k] = 0; break; }
        MultiByteToWideChar(CP_UTF8, 0, 临时, -1, 出, 容量);
        /* 去尾部空白 */
        int n = lstrlenW(出);
        while (n > 0 && (出[n - 1] == L' ' || 出[n - 1] == L'\t')) 出[--n] = 0;
        return 出[0] != 0;
    }
    return FALSE;
}

/* 读目标目录里已装的版本（<目录>\版本.txt） */
static BOOL 读已装版本(const WCHAR *目录, WCHAR *出, int 容量)
{
    出[0] = 0;
    WCHAR 路径[MAX_PATH * 2];
    _snwprintf(路径, MAX_PATH * 2 - 1, L"%s\\版本.txt", 目录);
    HANDLE f = CreateFileW(路径, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) return FALSE;
    char 缓冲[64] = { 0 };
    DWORD 读 = 0;
    ReadFile(f, 缓冲, sizeof(缓冲) - 1, &读, NULL);
    CloseHandle(f);
    for (DWORD k = 0; k < 读; k++) if (缓冲[k] == '\r' || 缓冲[k] == '\n') { 缓冲[k] = 0; break; }
    MultiByteToWideChar(CP_UTF8, 0, 缓冲, -1, 出, 容量);
    return 出[0] != 0;
}

/* 版本比较：a>b → 1，相等 → 0，a<b → -1（按 1.7.0 这种数字段比，忽略非数字后缀） */
static int 比版本(const WCHAR *a, const WCHAR *b)
{
    int 甲[4] = { 0, 0, 0, 0 }, 乙[4] = { 0, 0, 0, 0 };
    int 段 = 0;
    const WCHAR *p = a;
    while (*p && 段 < 4) {
        while (*p && (*p < L'0' || *p > L'9')) p++;
        if (!*p) break;
        甲[段++] = (int)wcstol(p, (wchar_t **)&p, 10);
    }
    段 = 0; p = b;
    while (*p && 段 < 4) {
        while (*p && (*p < L'0' || *p > L'9')) p++;
        if (!*p) break;
        乙[段++] = (int)wcstol(p, (wchar_t **)&p, 10);
    }
    for (int i = 0; i < 4; i++) {
        if (甲[i] > 乙[i]) return 1;
        if (甲[i] < 乙[i]) return -1;
    }
    return 0;
}

/* 刷新页1 那行版本提示（选目录/输入目录时调） */
static void 刷新版本提示(void)
{
    WCHAR 本次[32] = { 0 }, 已装[32] = { 0 }, 文[640];
    读内嵌文本("版本.txt", 本次, 32);
    if (!本次[0]) lstrcpynW(本次, L"未知", 32);

    BOOL 装过 = 读已装版本(g_目录, 已装, 32);
    if (!装过) {
        _snwprintf(文, 639,
            L"这个文件夹还是空的 → 会装成新的一份（v%s）。", 本次);
    } else {
        int c = 比版本(本次, 已装);
        if (c > 0)
            _snwprintf(文, 639,
                L"检测到已装 v%s  →  将更新到 v%s。\r\n"
                L"存档、账号、模组库、你自己放进 mode\\模组\\ 的文件全部保留。", 已装, 本次);
        else if (c == 0)
            _snwprintf(文, 639,
                L"已经是 v%s（和安装包同一版）→  重新安装＝修复损坏的文件，数据照旧保留。", 本次);
        else
            _snwprintf(文, 639,
                L"当前装的是 v%s，比安装包的 v%s 新。\r\n"
                L"继续会把这些游戏文件降级到 v%s，存档等数据仍然保留。", 已装, 本次);
    }
    lstrcpynW(g_版本文, 文, 640);
    if (g_窗) InvalidateRect(g_窗, NULL, FALSE);
}

static void 默认目录(WCHAR *出, int 容量)
{
    WCHAR 基[MAX_PATH * 2] = { 0 };
    if (!SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, 基))) {
        lstrcpynW(基, L"C:\\枪战突击", MAX_PATH * 2);
    }
    /* 【改成"原地更新"】以前装过就自动换名（枪战突击-2）→ 玩家想更新却装出第二份。
       现在默认就用同一个目录：装过就是更新（数据保留）；真想装第二份，自己把名字改一改。 */
    _snwprintf(出, 容量 - 1, L"%s\\枪战突击", 基);
}

/* 安装主过程（同步跑，文件小，几秒完） */
static void 执行安装(void)
{
    /* 目录规整 + 合法性校验（正斜杠换反斜杠、拒绝盘符根/系统目录） */
    规整路径(g_目录);
    WCHAR 原因[1024] = { 0 };
    if (!目录靠谱(g_目录, 原因, 1024)) {
        MessageBoxW(g_窗, 原因, L"目录不合适", MB_ICONWARNING);
        显示页(0);
        return;
    }

    建目录(g_目录);
    /* 可写测试 */
    WCHAR 测试文件[MAX_PATH * 2];
    _snwprintf(测试文件, MAX_PATH * 2 - 1, L"%s\\.写入测试", g_目录);
    HANDLE tf = CreateFileW(测试文件, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
        FILE_ATTRIBUTE_TEMPORARY, NULL);
    if (tf == INVALID_HANDLE_VALUE) {
        MessageBoxW(g_窗, L"这个目录写不进去。\n\n换一个（比如桌面上的一个新文件夹），或者用管理员身份运行安装器。",
            L"枪战突击", MB_ICONWARNING);
        显示页(0);
        return;
    }
    CloseHandle(tf); DeleteFileW(测试文件);

    /* 【版本检测·用户要求】同一个目录里已经装了同一个游戏但版本不同 → 自动按更新处理，
       并且**明确告诉玩家"只换游戏文件、数据一个都不动"**，让他放心点确认。 */
    {
        WCHAR 本次[32] = { 0 }, 已装[32] = { 0 };
        读内嵌文本("版本.txt", 本次, 32);
        if (本次[0] && 读已装版本(g_目录, 已装, 32)) {
            int c = 比版本(本次, 已装);
            WCHAR 问[900];
            int r;
            if (c > 0) {
                _snwprintf(问, 899,
                    L"检测到已安装 v%s，这次是更新到 v%s。\n\n"
                    L"会保留：存档 / 名字 / 金币 / 身份码 / 模组库 / 你自己加的模组。\n"
                    L"只会替换游戏本体的文件。\n\n现在更新吗？", 已装, 本次);
                r = MessageBoxW(g_窗, 问, L"枪战突击 · 版本检测", MB_ICONINFORMATION | MB_OKCANCEL | MB_DEFBUTTON1);
                if (r != IDOK) { 显示页(0); return; }
            } else if (c == 0) {
                _snwprintf(问, 899,
                    L"这个目录装的就是 v%s（和安装包同一版）。\n\n"
                    L"重新安装＝修复损坏或丢失的文件，存档和模组都不会动。\n\n继续吗？", 本次);
                r = MessageBoxW(g_窗, 问, L"枪战突击 · 版本检测", MB_ICONINFORMATION | MB_OKCANCEL);
                if (r != IDOK) { 显示页(0); return; }
            } else {
                _snwprintf(问, 899,
                    L"注意：这个目录装的是 v%s，比安装包里的 v%s 更新。\n\n"
                    L"继续会把游戏本体降级到 v%s（存档、模组等数据不动）。\n\n仍要降级吗？", 已装, 本次, 本次);
                r = MessageBoxW(g_窗, 问, L"枪战突击 · 版本检测", MB_ICONWARNING | MB_YESNO | MB_DEFBUTTON2);
                if (r != IDYES) { 显示页(0); return; }
            }
        }
    }

    显示页(1);
    InvalidateRect(g_窗, NULL, TRUE);
    UpdateWindow(g_窗);

    int i;
    for (i = 0; i < g_清单数; i++) {
        if (!写文件(i, g_目录)) {
            WCHAR 消息[600];
            _snwprintf(消息, 599, L"有个文件没写进去：\n%s\n\n请换个目录再试。", g_目录);
            MessageBoxW(g_窗, 消息, L"枪战突击", MB_ICONERROR);
            显示页(0);
            return;
        }
        {
            int 百分比 = g_总字节 ? (int)(g_已写 * 100 / g_总字节) : 100;
            g_进度百 = 百分比;
        }
        WCHAR 文[300];
        _snwprintf(文, 299, L"正在安装… %lld / %lld KB", g_已写 / 1024, g_总字节 / 1024);
        lstrcpynW(g_进度文, 文, 300);
        if (g_窗) { InvalidateRect(g_窗, NULL, FALSE); UpdateWindow(g_窗); }
    }

    BOOL 快捷 = FALSE;
    if (g_建快捷方式) {
        快捷 = 建全部快捷方式(g_目录);
        if (!快捷) {
            int r = MessageBoxW(g_窗,
                L"桌面快捷方式没建成（可能被安全软件拦了）。\n\n不影响游戏：安装目录里的「枪战客户端.exe」双击一样能玩。\n\n要再试一次吗？",
                L"枪战突击", MB_ICONWARNING | MB_YESNO);
            if (r == IDYES) 快捷 = 建全部快捷方式(g_目录);
        }
    }

    g_装好了 = TRUE;
    WCHAR 完成语[700];
    _snwprintf(完成语, 699,
        L"装好了：%s\n\n"
        L"· 桌面快捷方式：%s\n"
        L"· 想装第二份（数据/模组互不干扰）：重新运行本安装器，换个目录即可。",
        g_目录, 快捷 ? L"已创建「枪战突击」" : L"未创建（可手动进目录双击 exe）");
    if (g_页3控件[0]) SetWindowTextW(g_页3控件[0], 完成语);
    显示页(2);
}

/* ------------------------------------------------------------- 窗口过程 */

static LRESULT CALLBACK 窗口过程(HWND h, UINT m, WPARAM w, LPARAM l)
{
    switch (m) {
    case WM_CREATE: {
        /* ⚠️ 必须先存句柄：CreateWindowExW 是在 WM_CREATE **返回前**同步发出的，
           那时 wWinMain 里的 g_窗 还是 NULL → 所有控件以 NULL 为父窗口建，
           表现就是"只有一个空窗口"。 */
        g_窗 = h;
        {
            HDC dc = GetDC(NULL);
            g_dpi = GetDeviceCaps(dc, LOGPIXELSY);
            ReleaseDC(NULL, dc);
            if (g_dpi < 96) g_dpi = 96;
        }
        g_字 = 建字体();
        if (!g_框刷) g_框刷 = CreateSolidBrush(C_FIELD);
        /* 【1.9.49】只保留路径输入框，其余全部自绘（按钮由 排钮/画全 负责） */
        g_目录框 = CreateWindowW(L"EDIT", L"", WS_CHILD | ES_AUTOHSCROLL,
            S2(56), S2(192), S2(466), S2(30), h, (HMENU)2001, g_实例, NULL);
        SendMessageW(g_目录框, WM_SETFONT, (WPARAM)g_字, TRUE);
        默认目录(g_目录, MAX_PATH * 2);
        SetWindowTextW(g_目录框, g_目录);
        显示页(0);
        return 0;
    }

    case WM_ERASEBKGND:
        return 1;

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(h, &ps);
        RECT rc;
        HDC mem;
        HBITMAP bmp, old;
        GetClientRect(h, &rc);
        if (rc.right <= 0 || rc.bottom <= 0) { EndPaint(h, &ps); return 0; }
        mem = CreateCompatibleDC(dc);
        bmp = CreateCompatibleBitmap(dc, rc.right, rc.bottom);
        old = SelectObject(mem, bmp);
        画全(mem, rc.right, rc.bottom);
        BitBlt(dc, 0, 0, rc.right, rc.bottom, mem, 0, 0, SRCCOPY);
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);
        EndPaint(h, &ps);
        return 0;
    }

    case WM_CTLCOLOREDIT: {
        HDC dc = (HDC)w;
        SetTextColor(dc, C_TEXT);
        SetBkColor(dc, C_FIELD);
        return (LRESULT)g_框刷;
    }

    case WM_MOUSEMOVE: {
        int mx = GET_X_LPARAM(l), my = GET_Y_LPARAM(l);
        int i, 旧悬 = g_悬停;
        g_悬停 = -1;
        for (i = 0; i < g_钮数; i++)
            if (mx >= g_钮[i].r.left && mx < g_钮[i].r.right &&
                my >= g_钮[i].r.top && my < g_钮[i].r.bottom) { g_悬停 = g_钮[i].id; break; }
        if (旧悬 != g_悬停) {
            TRACKMOUSEEVENT tme;
            tme.cbSize = sizeof(tme);
            tme.dwFlags = TME_LEAVE;
            tme.hwndTrack = h;
            tme.dwHoverTime = 0;
            TrackMouseEvent(&tme);
            InvalidateRect(h, NULL, FALSE);
        }
        SetCursor(LoadCursorW(NULL, g_悬停 >= 0 ? IDC_HAND : IDC_ARROW));
        return 0;
    }

    case WM_MOUSELEAVE:
        g_悬停 = -1;
        InvalidateRect(h, NULL, FALSE);
        return 0;

    case WM_LBUTTONDOWN: {
        int mx = GET_X_LPARAM(l), my = GET_Y_LPARAM(l);
        int i;
        /* 两个复选框：自绘的，直接翻转全局变量 */
        if (g_页 == 0 && mx >= S2(34) && mx < S2(380) && my >= S2(368) && my < S2(406)) {
            g_建快捷方式 = !g_建快捷方式;
            InvalidateRect(h, NULL, FALSE);
            return 0;
        }
        if (g_页 == 2 && mx >= S2(34) && mx < S2(380) && my >= S2(338) && my < S2(376)) {
            g_立即启动 = !g_立即启动;
            InvalidateRect(h, NULL, FALSE);
            return 0;
        }
        /* 按钮：转发成 WM_COMMAND，复用原来那套 id 逻辑（一点没动） */
        for (i = 0; i < g_钮数; i++) {
            if (mx >= g_钮[i].r.left && mx < g_钮[i].r.right &&
                my >= g_钮[i].r.top && my < g_钮[i].r.bottom) {
                SendMessageW(h, WM_COMMAND, MAKEWPARAM(g_钮[i].id, 0), 0);
                return 0;
            }
        }
        return 0;
    }

    case WM_COMMAND: {
        int id = LOWORD(w);
        if (id == 1003) { DestroyWindow(h); return 0; }                    /* 取消 */
        if (id == 1002) { 显示页(0); return 0; }                           /* 下一步 */
        if (id == 2004) { 显示页(0); return 0; }                           /* 上一步 */
        if (id == 2002) {                                                 /* 浏览… */
            BROWSEINFOW bi;
            memset(&bi, 0, sizeof(bi));
            bi.hwndOwner = h;
            bi.lpszTitle = L"选一个文件夹（不存在的话会自动建）";
            bi.ulFlags = BIF_NEWDIALOGSTYLE | BIF_RETURNONLYFSDIRS | BIF_EDITBOX;
            PIDLIST_ABSOLUTE 项 = SHBrowseForFolderW(&bi);
            if (项) {
                WCHAR 选[MAX_PATH * 2] = { 0 };
                if (SHGetPathFromIDListW(项, 选)) {
                    lstrcpynW(g_目录, 选, MAX_PATH * 2);
                    SetWindowTextW(g_目录框, g_目录);
                    刷新版本提示();
                }
                CoTaskMemFree(项);
            }
            return 0;
        }
        if (id == 2001 && HIWORD(w) == EN_CHANGE) {                       /* 目录框改了 */
            GetWindowTextW(g_目录框, g_目录, MAX_PATH * 2);
            刷新版本提示();
            return 0;
        }
        if (id == 2003) {                                                 /* 开始安装 */
            WCHAR 填的[MAX_PATH * 2] = { 0 };
            GetWindowTextW(g_目录框, 填的, MAX_PATH * 2);
            lstrcpynW(g_目录, 填的, MAX_PATH * 2);
            执行安装();
            return 0;
        }
        if (id == 4001) { g_建快捷方式 = IsDlgButtonChecked(h, 4001) == BST_CHECKED; return 0; }
        if (id == 4002) { g_立即启动 = IsDlgButtonChecked(h, 4002) == BST_CHECKED; return 0; }
        if (id == 4003) {                                                 /* 完成 */
            if (g_立即启动 && g_装好了) {
                WCHAR exe[MAX_PATH * 2];
                _snwprintf(exe, MAX_PATH * 2 - 1, L"%s\\枪战客户端.exe", g_目录);
                ShellExecuteW(NULL, L"open", exe, NULL, g_目录, SW_SHOWNORMAL);
            }
            DestroyWindow(h);
            return 0;
        }
        return 0;
    }
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

/* --------------------------------------------------------------- 卸载模式 */

static int 卸载(int 参数个数, wchar_t **参数)
{
    if (参数个数 < 2) {
        MessageBoxW(NULL, L"用法：本程序 /卸载 <安装目录>", L"枪战突击卸载", MB_ICONINFORMATION);
        return 2;
    }
    const WCHAR *目录 = 参数[1];

    /* 先删桌面快捷方式 */
    WCHAR 桌面[MAX_PATH * 2] = { 0 };
    WCHAR lnk[MAX_PATH * 2];
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, 桌面))) {
        _snwprintf(lnk, MAX_PATH * 2 - 1, L"%s\\枪战突击.lnk", 桌面);
        DeleteFileW(lnk);
    }

    /* 再删整个安装目录（SHFileOperation，双 \0 结尾） */
    WCHAR 从[MAX_PATH * 2 + 1] = { 0 };
    lstrcpynW(从, 目录, MAX_PATH * 2);
    从[lstrlenW(从) + 1] = 0;
    SHFILEOPSTRUCTW op;
    memset(&op, 0, sizeof(op));
    op.wFunc = FO_DELETE;
    op.pFrom = 从;
    op.fFlags = FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI;

    /* ⚠️ MB_DEFBUTTON2：默认焦点放「取消」上。误按回车不该直接删掉人家的存档。 */
    int r = MessageBoxW(NULL,
        L"确定卸载《枪战突击》电脑客户端吗？\n\n安装目录里的文件会全部删除（包括你在游戏里装的模组和本地存档）。",
        L"枪战突击卸载", MB_ICONWARNING | MB_OKCANCEL | MB_DEFBUTTON2);
    if (r != IDOK) return 1;

    int 结果 = SHFileOperationW(&op);
    if (结果 == 0 && !GetFileAttributesW(目录)) {
        MessageBoxW(NULL, L"卸载完成。桌面图标如还在，手动删掉即可。", L"枪战突击", MB_ICONINFORMATION);
        return 0;
    }
    MessageBoxW(NULL, L"有些文件没删掉（可能游戏正在运行）。\n\n关掉游戏后再试，或手动删掉安装目录。",
        L"枪战突击", MB_ICONWARNING);
    return 3;
}

/* ------------------------------------------------------------------ 入口 */

int WINAPI wWinMain(HINSTANCE 实例, HINSTANCE 上个, PWSTR 命令行, int 显示)
{
    (void)上个;
    g_实例 = 实例;
    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);

    /* 卸载模式：安装器.exe /卸载 <目录> */
    int 参数个数 = 0;
    wchar_t **参数 = CommandLineToArgvW(GetCommandLineW(), &参数个数);
    if (参数个数 >= 2 && (lstrcmpiW(参数[1], L"/卸载") == 0 || lstrcmpiW(参数[1], L"/uninstall") == 0)) {
        int r = 卸载(参数个数, 参数);
        CoUninitialize();
        return r;
    }

    /* 静默安装：安装器.exe /S <目录> [/等待 <pid>] [/启动]
       /等待  先等这个进程退出再写文件 —— 客户端内升级就靠它（旧客户端不退，文件被占用写不进去）
       /启动  装完直接启动 <目录>\枪战客户端.exe —— 和 /等待 配合就是"自动升级并重启"
       【1.9.55】只装到调用方给的目录，绝不改到 C 盘/默认目录。 */
    if (参数个数 >= 3 && lstrcmpiW(参数[1], L"/S") == 0) {
        DWORD 等pid = 0;
        int 要启动 = 0;
        for (int k = 3; k < 参数个数; k++) {
            if (lstrcmpiW(参数[k], L"/等待") == 0 && k + 1 < 参数个数) {
                等pid = (DWORD)wcstoul(参数[k + 1], NULL, 10);
            } else if (lstrcmpiW(参数[k], L"/启动") == 0) {
                要启动 = 1;
            }
        }
        if (等pid) {
            HANDLE 旧 = OpenProcess(SYNCHRONIZE, FALSE, 等pid);
            if (旧) { WaitForSingleObject(旧, 120000); CloseHandle(旧); }
            Sleep(900);           /* 再给 WebView2 子进程一点时间释放文件句柄 */
        }
        if (!读清单()) return 5;
        lstrcpynW(g_目录, 参数[2], MAX_PATH * 2);
        规整路径(g_目录);
        if (!目录靠谱(g_目录, (WCHAR *)L"", 0)) return 7;
        建目录(g_目录);
        int i;
        for (i = 0; i < g_清单数; i++) {
            /* 升级时旧文件可能还在被占用：重试几次，别整包失败 */
            int 次 = 0;
            while (!写文件(i, g_目录) && 次 < 12) { Sleep(400); 次++; }
            if (次 >= 12) return 6;
            g_进度百 = g_总字节 ? (int)(g_已写 * 100 / g_总字节) : 100;
        }
        建全部快捷方式(g_目录);
        if (要启动) {
            WCHAR exe[MAX_PATH * 2];
            _snwprintf(exe, MAX_PATH * 2 - 1, L"%s\\枪战客户端.exe", g_目录);
            ShellExecuteW(NULL, L"open", exe, NULL, g_目录, SW_SHOWNORMAL);
        }
        CoUninitialize();
        return 0;
    }

    /* 位数检测：本安装器是 64 位的 */
    SYSTEM_INFO si;
    GetNativeSystemInfo(&si);
    if (si.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_INTEL) {
        MessageBoxW(NULL,
            L"这台电脑是 32 位系统，《枪战突击》电脑客户端目前只提供 64 位版本。\n\n"
            L"32 位系统可以玩网页版：用浏览器打开游戏网页即可（功能一样，也不占地方）。",
            L"枪战突击", MB_ICONINFORMATION);
        CoUninitialize();
        return 4;
    }

    if (!读清单()) {
        MessageBoxW(NULL, L"安装包数据损坏了（读不到内嵌文件）。请重新下载本安装器。",
            L"枪战突击", MB_ICONERROR);
        CoUninitialize();
        return 5;
    }

    INITCOMMONCONTROLSEX icc;
    icc.dwSize = sizeof(icc);
    icc.dwICC = ICC_PROGRESS_CLASS;
    InitCommonControlsEx(&icc);

    WNDCLASSEXW wc;
    memset(&wc, 0, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = 窗口过程;
    wc.hInstance = 实例;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_BTNFACE + 1);
    wc.lpszClassName = L"QZST安装器";
    wc.hIcon = LoadIconW(实例, MAKEINTRESOURCEW(1000));
    if (!wc.hIcon) wc.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    wc.hIconSm = wc.hIcon;
    RegisterClassExW(&wc);

    g_窗 = CreateWindowExW(0, L"QZST安装器", L"枪战突击 · 电脑客户端 安装",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
        CW_USEDEFAULT, CW_USEDEFAULT, 720, 520,
        NULL, NULL, 实例, NULL);
    if (!g_窗) return 0;

    ShowWindow(g_窗, 显示 ? 显示 : SW_SHOWNORMAL);
    UpdateWindow(g_窗);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    CoUninitialize();
    return 0;
}
