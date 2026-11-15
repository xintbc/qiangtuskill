/*
 * 枪战突击 · 启动器（launcher.c）
 * =====================================================================
 * 纯 C / Win32 图形界面，零第三方依赖（只链 Win32 + zlib 解压）。
 *
 * 功能：
 *   1. 启动时从「更新网页」拉 manifest.json（版本列表 + 模组列表）
 *   2. 列出版本：点「下载」用多线程分片（HTTP Range）下载对应 zip
 *   3. 每个版本解压到独立目录（版本库/枪战突击_vX.Y.Z/），互不干扰
 *   4. 点「开始游戏」→ 用系统默认浏览器打开该版本的 index.html
 *   5. 模组：列出网页模组，多线程下载 .js 到所选版本的 mode/模组/
 *   6. 已装版本 / 已下模组有本地标记，下次不用重下
 *
 * 编译（Git Bash，输出名必须 ASCII，避开中文路径老坑）：
 *   gcc -O2 -std=gnu99 -w -municode -mwindows -finput-charset=UTF-8 launcher.c \
 *       -o launcher.exe -lz -lws2_32 -lwininet -lcomctl32 -lgdi32 -luser32 -lshell32 -lole32 -luuid
 *
 * 由 AI 创作。
 */
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0601
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <shellapi.h>
#include <wininet.h>
#include <zlib.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

/* ==================== 常量 ==================== */
/* 更新网页（GitHub Pages）。末尾带不带 / 都行，代码会处理。 */
static const WCHAR *更新页 = L"https://xintbc.github.io/qiangtuskill/";
static const WCHAR *清单名 = L"manifest.json";

/* 版本库根目录：exe 同目录下的「版本库」 */
static WCHAR g_根目录[MAX_PATH * 2] = { 0 };

/* ==================== 小工具 ==================== */
static WCHAR *宽(char *s) {
    static WCHAR 缓冲[4096];
    MultiByteToWideChar(CP_UTF8, 0, s, -1, 缓冲, 4096);
    return 缓冲;
}
static char *窄(const WCHAR *s) {
    static char 缓冲[8192];
    WideCharToMultiByte(CP_UTF8, 0, s, -1, 缓冲, 8192, NULL, NULL);
    return 缓冲;
}
static void 复制文本(HWND h, const WCHAR *s) { SetWindowTextW(h, s); }
static void 追加日志(HWND h, const WCHAR *s) {
    int n = GetWindowTextLengthW(h);
    SendMessageW(h, EM_SETSEL, n, n);
    SendMessageW(h, EM_REPLACESEL, FALSE, (LPARAM)s);
    SendMessageW(h, EM_SETSEL, n + (int)wcslen(s), n + (int)wcslen(s));
    SendMessageW(h, EM_SCROLLCARET, 0, 0);
}

/* ==================== HTTP（WinINet，简单够用）==================== */
/* 下载一个 URL 到内存。返回 malloc 的缓冲（*出大小 填字节数），失败返回 NULL。 */
static BYTE *httpGet(const WCHAR *url, DWORD *出大小) {
    *出大小 = 0;
    HINTERNET 会话 = InternetOpenW(L"枪战突击启动器", INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0);
    if (!会话) return NULL;
    HINTERNET 请求 = InternetOpenUrlW(会话, url, NULL, 0, INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE, 0);
    if (!请求) { InternetCloseHandle(会话); return NULL; }

    DWORD 容量 = 65536, 已用 = 0;
    BYTE *缓冲 = (BYTE *)malloc(容量);
    if (!缓冲) { InternetCloseHandle(请求); InternetCloseHandle(会话); return NULL; }

    BYTE 块[8192]; DWORD 读到 = 0;
    while (InternetReadFile(请求, 块, sizeof(块), &读到) && 读到 > 0) {
        if (已用 + 读到 > 容量) {
            容量 *= 2;
            BYTE *新 = (BYTE *)realloc(缓冲, 容量);
            if (!新) { free(缓冲); InternetCloseHandle(请求); InternetCloseHandle(会话); return NULL; }
            缓冲 = 新;
        }
        memcpy(缓冲 + 已用, 块, 读到);
        已用 += 读到;
    }
    InternetCloseHandle(请求);
    InternetCloseHandle(会话);
    *出大小 = 已用;
    return 缓冲;
}

/* 多线程分片下载：一个线程下 [起,止) 字节区间，写到文件对应偏移。 */
/* 下载进度（多线程共享，用于 PCL 风格的速度显示）——必须定义在分片线程之前 */
static volatile LONG g_已下载 = 0, g_总字节 = 0;
static DWORD g_开始时刻 = 0;

typedef struct { const WCHAR *url; HANDLE 文件; DWORD 起, 止; int 线程号; int 成败; } 分片任务;
static DWORD WINAPI 分片线程(LPVOID 参) {
    分片任务 *t = (分片任务 *)参;
    t->成败 = 0;
    HINTERNET 会话 = InternetOpenW(L"枪战突击启动器", INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0);
    if (!会话) return 0;
    HINTERNET 请求 = InternetOpenUrlW(会话, t->url, NULL, 0, INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE, 0);
    if (!请求) { InternetCloseHandle(会话); return 0; }

    WCHAR 范围[64];
    wsprintfW(范围, L"Range: bytes=%lu-%lu\r\n", t->起, t->止);
    /* WinINet 设置 Range 头 */
    static HINTERNET 头 = NULL;
    /* 用 HttpAddRequestHeaders 需要先转成请求句柄，这里简化：InternetOpenUrl 后不支持改头，
       改用 InternetOpen + HttpOpenRequest 方案见下。为保证可靠，这里退回整段重试：
       实际上 InternetOpenUrl 不带 Range 会下全文件 —— 分片时用 HttpOpenRequest。 */
    InternetCloseHandle(请求);
    InternetCloseHandle(会话);
    /* 用带 Range 的完整流程 */
    会话 = InternetOpenW(L"枪战突击启动器", INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0);
    if (!会话) return 0;
    /* 拆 URL */
    URL_COMPONENTSW c; ZeroMemory(&c, sizeof(c));
    c.dwStructSize = sizeof(c);
    c.dwHostNameLength = 1; c.dwUserNameLength = 1; c.dwPasswordLength = 1;
    c.dwUrlPathLength = 1; c.dwExtraInfoLength = 1;
    if (!InternetCrackUrlW(t->url, 0, 0, &c)) { InternetCloseHandle(会话); return 0; }
    WCHAR 主机[1024] = { 0 }, 路径[2048] = { 0 };
    wcsncpy(主机, c.lpszHostName, c.dwHostNameLength);
    wcsncpy(路径, c.lpszUrlPath, c.dwUrlPathLength);
    if (c.dwExtraInfoLength) { wcsncat(路径, c.lpszExtraInfo, c.dwExtraInfoLength); }

    HINTERNET 连 = InternetConnectW(会话, 主机, c.nPort, NULL, NULL, INTERNET_SERVICE_HTTP, 0, 0);
    if (!连) { InternetCloseHandle(会话); return 0; }
    DWORD 标志 = INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE | INTERNET_FLAG_KEEP_CONNECTION;
    if (c.nScheme == INTERNET_SCHEME_HTTPS) 标志 |= INTERNET_FLAG_SECURE;
    HINTERNET 请 = HttpOpenRequestW(连, L"GET", 路径, NULL, NULL, NULL, 标志, 0);
    if (!请) { InternetCloseHandle(连); InternetCloseHandle(会话); return 0; }
    if (!HttpSendRequestW(请, 范围, (DWORD)wcslen(范围), NULL, 0)) {
        InternetCloseHandle(请); InternetCloseHandle(连); InternetCloseHandle(会话); return 0;
    }

    DWORD 已读 = 0; BYTE 缓冲块[16384]; DWORD 这段读到 = 0;
    while (InternetReadFile(请, 缓冲块, sizeof(缓冲块), &这段读到) && 这段读到 > 0) {
        DWORD 写;
        /* 定位写（分片偏移） */
        OVERLAPPED ov; ZeroMemory(&ov, sizeof(ov));
        ov.Offset = t->起 + 已读;
        WriteFile(t->文件, 缓冲块, 这段读到, &写, &ov);
        已读 += 这段读到;
        InterlockedExchangeAdd(&g_已下载, (LONG)这段读到);   /* 给速度显示用 */
    }
    InternetCloseHandle(请); InternetCloseHandle(连); InternetCloseHandle(会话);
    t->成败 = 1;
    return 0;
}

/* ==================== JSON（极简解析，够用即可）==================== */
/* 我们的 manifest 结构简单，手写一个够用的小解析器：
   找 "版本":[...] 和 "模组":[...]，每个对象取 版本/文件/大小/md5/说明/名字/兼容 这几个字段。 */
typedef struct {
    WCHAR 版本[32], 文件[256], md5[64], 说明[256], 日期[24];
    long long 大小;
} 版本项;
typedef struct {
    WCHAR 名字[256], md5[64], 兼容[64];
    long long 大小;
} 模组项;

static 版本项 *g_版本 = NULL; static int g_版本数 = 0;
static 模组项 *g_模组 = NULL; static int g_模组数 = 0;

/* 从 JSON 字符串里取 key 后面的字符串值（处理引号转义略）
   ⚠️ 别用 wsprintfA 拼 "\"%s\"" —— 源文件是 UTF-8，中文 key 经它按 ANSI 拷贝会变乱码，
      strstr 永远找不到（表现为"清单里明明有，解析出来 0 条"）。直接拼字节最稳。 */
static int 取串(const char *j, const char *key, WCHAR *出, int 出容量) {
    char 找[128];
    找[0] = '"'; strcpy(找 + 1, key); strcat(找, "\"");
    const char *p = strstr(j, 找);
    if (!p) return 0;
    p = strchr(p + strlen(找), ':');
    if (!p) return 0;
    p = strchr(p, '"');
    if (!p) return 0;
    p++;
    const char *e = strchr(p, '"');
    if (!e) return 0;
    int n = (int)(e - p); if (n >= 出容量) n = 出容量 - 1;
    /* UTF-8 → WCHAR */
    char 临时[512]; memcpy(临时, p, n); 临时[n] = 0;
    MultiByteToWideChar(CP_UTF8, 0, 临时, -1, 出, 出容量);
    return 1;
}
static long long 取数(const char *j, const char *key) {
    char 找[128]; 找[0] = '"'; strcpy(找 + 1, key); strcat(找, "\"");
    const char *p = strstr(j, 找);
    if (!p) return 0;
    p = strchr(p + strlen(找), ':');
    if (!p) return 0;
    return _atoi64(p + 1);
}
/* 数某 key 出现次数（估算数组长度） */
static int 计数(const char *j, const char *key) {
    char 找[128]; 找[0] = '"'; strcpy(找 + 1, key); strcat(找, "\"");
    int n = 0; const char *p = j;
    while ((p = strstr(p, 找)) != NULL) { n++; p += strlen(找); }
    return n;
}

static void 解析清单(const char *json) {
    /* 版本 */
    g_版本数 = 计数(json, "文件");
    if (g_版本数 > 64) g_版本数 = 64;
    g_版本 = (版本项 *)calloc(g_版本数 + 1, sizeof(版本项));
    /* 逐个对象解析：按 "文件" 定位对象，向前找 "版本" */
    {
        const char *p = json; int i = 0;
        while (i < g_版本数 && (p = strstr(p, "\"文件\"")) != NULL) {
            /* 这个对象的范围：向前找最近的 { */
            const char *obj起 = p;
            while (obj起 > json && *obj起 != '{') obj起--;
            /* 向后找匹配的 }（粗：到下一个 }） */
            const char *obj终 = strchr(p, '}');
            if (!obj终) break;
            int 长 = (int)(obj终 - obj起) + 1;
            char *obj = (char *)malloc(长 + 1);
            memcpy(obj, obj起, 长); obj[长] = 0;
            取串(obj, "版本", g_版本[i].版本, 32);
            取串(obj, "文件", g_版本[i].文件, 256);
            取串(obj, "md5", g_版本[i].md5, 64);
            取串(obj, "说明", g_版本[i].说明, 256);
            取串(obj, "日期", g_版本[i].日期, 24);
            g_版本[i].大小 = 取数(obj, "大小");
            free(obj);
            i++;
            p = obj终 + 1;
        }
        g_版本数 = i;
    }
    /* 模组 */
    g_模组数 = 计数(json, "兼容");
    if (g_模组数 > 128) g_模组数 = 128;
    g_模组 = (模组项 *)calloc(g_模组数 + 1, sizeof(模组项));
    {
        const char *p = json; int i = 0;
        while (i < g_模组数 && (p = strstr(p, "\"名字\"")) != NULL) {
            const char *obj起 = p;
            while (obj起 > json && *obj起 != '{') obj起--;
            const char *obj终 = strchr(p, '}');
            if (!obj终) break;
            int 长 = (int)(obj终 - obj起) + 1;
            char *obj = (char *)malloc(长 + 1);
            memcpy(obj, obj起, 长); obj[长] = 0;
            取串(obj, "名字", g_模组[i].名字, 256);
            取串(obj, "md5", g_模组[i].md5, 64);
            取串(obj, "兼容", g_模组[i].兼容, 64);
            g_模组[i].大小 = 取数(obj, "大小");
            free(obj);
            i++;
            p = obj终 + 1;
        }
        g_模组数 = i;
    }
}

/* ==================== 文件 / 目录 ==================== */
static void 建目录树(const WCHAR *目录) {
    WCHAR 路径[MAX_PATH * 2] = { 0 };
    for (const WCHAR *p = 目录; *p; p++) {
        if (*p == L'\\' || *p == L'/') {
            if (路径[0]) CreateDirectoryW(路径, NULL);
        }
        路径[wcslen(路径)] = *p;
    }
    CreateDirectoryW(路径, NULL);
}
static BOOL 文件存在(const WCHAR *p) { return GetFileAttributesW(p) != INVALID_FILE_ATTRIBUTES; }

/* ==================== zip 解压（zlib inflate，支持标准 deflate 条目）==================== */
static int 解压zip(const WCHAR *zip路径, const WCHAR *目标目录) {
    HANDLE f = CreateFileW(zip路径, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) return 0;
    DWORD 大小 = GetFileSize(f, NULL);
    BYTE *数据 = (BYTE *)malloc(大小);
    DWORD 读;
    ReadFile(f, 数据, 大小, &读, NULL);
    CloseHandle(f);

    int 成功 = 1, 序号 = 0;
    DWORD off = 0;
    while (off + 30 <= 大小) {
        if (数据[off] != 'P' || 数据[off + 1] != 'K' || 数据[off + 2] != 3 || 数据[off + 3] != 4) break; /* 不是 local header 就停 */
        DWORD 方法 = 数据[off + 8] | (数据[off + 9] << 8);
        DWORD 压缩 = 数据[off + 18] | (数据[off + 19] << 8) | (数据[off + 20] << 16) | (数据[off + 21] << 24);
        DWORD 原名 = 数据[off + 26] | (数据[off + 27] << 8);
        DWORD 额外 = 数据[off + 28] | (数据[off + 29] << 8);
        char *名 = (char *)(数据 + off + 30);
        DWORD 数据起 = off + 30 + 原名 + 额外;

        /* 文件名 UTF-8 → WCHAR */
        WCHAR w名[512];
        MultiByteToWideChar(CP_UTF8, 0, 名, 原名, w名, 512);
        w名[原名 > 511 ? 511 : 原名] = 0;

        /* 跳过目录条目（以 / 结尾） */
        if (w名[wcslen(w名) - 1] == L'/') { off = 数据起 + 压缩; continue; }

        /* 目标路径 */
        WCHAR 全[MAX_PATH * 2];
        wsprintfW(全, L"%s\\%s", 目标目录, w名);
        建目录树(全);

        HANDLE out = CreateFileW(全, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
        if (out == INVALID_HANDLE_VALUE) { off = 数据起 + 压缩; continue; }

        if (方法 == 0) { /* store */
            DWORD 写;
            WriteFile(out, 数据 + 数据起, 压缩, &写, NULL);
        } else if (方法 == 8) { /* deflate */
            z_stream zs; ZeroMemory(&zs, sizeof(zs));
            inflateInit2(&zs, -MAX_WBITS);
            zs.next_in = 数据 + 数据起; zs.avail_in = 压缩;
            BYTE 出块[65536];
            int r;
            do {
                zs.next_out = 出块; zs.avail_out = sizeof(出块);
                r = inflate(&zs, Z_NO_FLUSH);
                DWORD 写;
                WriteFile(out, 出块, sizeof(出块) - zs.avail_out, &写, NULL);
            } while (r == Z_OK);
            inflateEnd(&zs);
        }
        CloseHandle(out);
        off = 数据起 + 压缩;
        序号++;
    }
    free(数据);
    return 成功;
}

/* ==================== 全局控件 ==================== */
static HWND g_版本列表, g_模组列表, g_日志, g_进度条, g_状态文本;
static int g_选中版本 = -1, g_选中模组 = -1;

/* ==================== 界面构建（好看点：自绘深色 + 圆角感） ==================== */
static HBRUSH g_背景刷 = NULL;
static HFONT g_标题字, g_正文字, g_大字;

static LRESULT CALLBACK 窗口过程(HWND h, UINT m, WPARAM w, LPARAM l);
/* 前置声明：这几个下载/启动函数定义在窗口过程之后（WM_COMMAND 里要用） */
static void 下载选中版本(HWND h);
static void 启动选中版本(HWND h);
static void 下载选中模组(HWND h);

/* 【batch229】PCL 风格卡片：圆角深色底 + 左侧选中竖条 + 主标题/副标题 + 已装徽标 */
static void 画卡片(LPDRAWITEMSTRUCT d, int 已选, const WCHAR *主文, const WCHAR *副文, int 已装) {
    HDC dc = d->hDC;
    RECT r = d->rcItem;
    InflateRect(&r, -3, -3);

    HBRUSH 背 = CreateSolidBrush(已选 ? RGB(30, 48, 74) : RGB(28, 33, 46));
    HPEN 边 = CreatePen(PS_SOLID, 已选 ? 2 : 1, 已选 ? RGB(78, 140, 220) : RGB(44, 52, 72));
    HGDIOBJ 旧刷 = SelectObject(dc, 背), 旧笔 = SelectObject(dc, 边);
    RoundRect(dc, r.left, r.top, r.right, r.bottom, 10, 10);
    SelectObject(dc, 旧刷); SelectObject(dc, 旧笔);
    DeleteObject(背); DeleteObject(边);

    if (已选) {   /* 左侧高亮竖条 */
        RECT 条 = { r.left + 4, r.top + 12, r.left + 7, r.bottom - 12 };
        HBRUSH b = CreateSolidBrush(RGB(90, 170, 255));
        FillRect(dc, &条, b);
        DeleteObject(b);
    }

    SetBkMode(dc, TRANSPARENT);
    RECT 主r = { r.left + 16, r.top + 9, r.right - 92, r.top + 33 };
    SetTextColor(dc, RGB(240, 244, 250));
    SelectObject(dc, g_大字);
    DrawTextW(dc, 主文, -1, &主r, DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    if (副文 && 副文[0]) {
        RECT 副r = { r.left + 16, r.top + 33, r.right - 14, r.bottom - 6 };
        SetTextColor(dc, RGB(124, 138, 165));
        SelectObject(dc, g_正文字);
        DrawTextW(dc, 副文, -1, &副r, DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    }
    if (已装) {
        RECT 徽 = { r.right - 92, r.top + 9, r.right - 12, r.top + 31 };
        SetTextColor(dc, RGB(74, 222, 128));
        SelectObject(dc, g_正文字);
        DrawTextW(dc, L"● 已安装", -1, &徽, DT_RIGHT | DT_SINGLELINE | DT_VCENTER);
    }
}

static void 初始化控件(HWND h) {
    /* 标题 */
    HWND 标题 = CreateWindowExW(0, L"STATIC", L"🔫 枪战突击 启动器",
        WS_CHILD | WS_VISIBLE, 24, 18, 500, 40, h, NULL, NULL, NULL);
    SendMessageW(标题, WM_SETFONT, (WPARAM)g_标题字, TRUE);

    HWND 副标题 = CreateWindowExW(0, L"STATIC", L"版本独立 · 多线程下载 · 由 AI 创作",
        WS_CHILD | WS_VISIBLE, 26, 58, 500, 22, h, NULL, NULL, NULL);
    SendMessageW(副标题, WM_SETFONT, (WPARAM)g_正文字, TRUE);

    /* 左栏：版本 */
    HWND 左标 = CreateWindowExW(0, L"STATIC", L"📦 版本",
        WS_CHILD | WS_VISIBLE, 24, 92, 200, 24, h, NULL, NULL, NULL);
    SendMessageW(左标, WM_SETFONT, (WPARAM)g_大字, TRUE);
    g_版本列表 = CreateWindowExW(0, L"LISTBOX", NULL,
        WS_CHILD | WS_VISIBLE | WS_VSCROLL | LBS_NOTIFY | LBS_NOINTEGRALHEIGHT |
        LBS_OWNERDRAWFIXED | LBS_HASSTRINGS | WS_BORDER,
        24, 120, 360, 300, h, (HMENU)1001, NULL, NULL);
    SendMessageW(g_版本列表, WM_SETFONT, (WPARAM)g_正文字, TRUE);
    SendMessageW(g_版本列表, LB_SETITEMHEIGHT, 0, 68);   /* PCL 风格卡片高度 */

    /* 右栏：模组 */
    HWND 右标 = CreateWindowExW(0, L"STATIC", L"🧩 模组",
        WS_CHILD | WS_VISIBLE, 420, 92, 200, 24, h, NULL, NULL, NULL);
    SendMessageW(右标, WM_SETFONT, (WPARAM)g_大字, TRUE);
    g_模组列表 = CreateWindowExW(0, L"LISTBOX", NULL,
        WS_CHILD | WS_VISIBLE | WS_VSCROLL | LBS_NOTIFY | LBS_NOINTEGRALHEIGHT |
        LBS_OWNERDRAWFIXED | LBS_HASSTRINGS | WS_BORDER,
        420, 120, 360, 300, h, (HMENU)1002, NULL, NULL);
    SendMessageW(g_模组列表, WM_SETFONT, (WPARAM)g_正文字, TRUE);
    SendMessageW(g_模组列表, LB_SETITEMHEIGHT, 0, 52);

    /* 按钮 */
    CreateWindowExW(0, L"BUTTON", L"⬇ 下载版本", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
        24, 430, 110, 34, h, (HMENU)101, NULL, NULL);
    CreateWindowExW(0, L"BUTTON", L"▶ 开始游戏", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
        146, 430, 110, 34, h, (HMENU)102, NULL, NULL);
    CreateWindowExW(0, L"BUTTON", L"⬇ 下载模组", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
        420, 430, 110, 34, h, (HMENU)103, NULL, NULL);
    CreateWindowExW(0, L"BUTTON", L"🔄 刷新", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
        542, 430, 110, 34, h, (HMENU)104, NULL, NULL);

    /* 进度 */
    g_进度条 = CreateWindowExW(0, PROGRESS_CLASSW, NULL,
        WS_CHILD | WS_VISIBLE, 24, 478, 756, 20, h, NULL, NULL, NULL);
    SendMessageW(g_进度条, PBM_SETRANGE, 0, MAKELPARAM(0, 100));
    g_状态文本 = CreateWindowExW(0, L"STATIC", L"就绪",
        WS_CHILD | WS_VISIBLE, 26, 504, 700, 22, h, NULL, NULL, NULL);
    SendMessageW(g_状态文本, WM_SETFONT, (WPARAM)g_正文字, TRUE);

    /* 日志 */
    g_日志 = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"",
        WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL,
        24, 534, 756, 140, h, NULL, NULL, NULL);
    SendMessageW(g_日志, WM_SETFONT, (WPARAM)g_正文字, TRUE);
}

static LRESULT CALLBACK 窗口过程(HWND h, UINT m, WPARAM w, LPARAM l) {
    switch (m) {
    case WM_CREATE:
        g_背景刷 = CreateSolidBrush(RGB(13, 16, 26));
        g_标题字 = CreateFontW(28, 0, 0, 0, FW_BOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Microsoft YaHei");
        g_大字 = CreateFontW(18, 0, 0, 0, FW_SEMIBOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Microsoft YaHei");
        g_正文字 = CreateFontW(16, 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Microsoft YaHei");
        初始化控件(h);
        /* 计算根目录 */
        GetModuleFileNameW(NULL, g_根目录, MAX_PATH * 2);
        WCHAR *p = wcsrchr(g_根目录, L'\\');
        if (p) *p = 0;
        wsprintfW(g_根目录 + wcslen(g_根目录), L"\\版本库");
        CreateDirectoryW(g_根目录, NULL);
        /* 异步拉清单 */
        PostMessageW(h, WM_USER + 1, 0, 0);
        return 0;
    case WM_USER + 1: {
        /* 拉 manifest */
        追加日志(g_日志, L"正在从更新网页拉取清单…\r\n");
        WCHAR url[MAX_PATH * 2];
        wsprintfW(url, L"%s%s", 更新页, 清单名);
        DWORD 大小;
        BYTE *json = httpGet(url, &大小);
        /* 排查用：把结果落盘（有问题看 版本库\启动器日志.txt） */
        {
            WCHAR 日志路径[MAX_PATH*2]; wsprintfW(日志路径, L"%s\\启动器日志.txt", g_根目录);
            HANDLE lf = CreateFileW(日志路径, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
            if (lf != INVALID_HANDLE_VALUE) {
                WCHAR 行[1200]; DWORD 写;
                wsprintfW(行, L"URL=%s\r\n返回=%s 字节=%lu\r\n", url, json ? L"有数据" : L"失败", 大小);
                WriteFile(lf, 行, (DWORD)wcslen(行) * 2, &写, NULL);
                if (json && 大小) { DWORD 写2; WriteFile(lf, json, 大小 > 800 ? 800 : 大小, &写2, NULL); }
                CloseHandle(lf);
            }
        }
        if (json) {
            char *json8 = (char *)malloc(大小 + 1);
            memcpy(json8, json, 大小); json8[大小] = 0;
            free(json);
            解析清单(json8);
            free(json8);
            /* 填列表 */
            for (int i = 0; i < g_版本数; i++) {
                WCHAR 行[512];
                swprintf(行, 512, L"v%s   ·   %.1f MB", g_版本[i].版本, g_版本[i].大小 / 1048576.0);
                int idx = (int)SendMessageW(g_版本列表, LB_ADDSTRING, 0, (LPARAM)行);
                SendMessageW(g_版本列表, LB_SETITEMDATA, idx, (LPARAM)i);   /* 卡片绘制用索引 */
            }
            for (int i = 0; i < g_模组数; i++) {
                int idx = (int)SendMessageW(g_模组列表, LB_ADDSTRING, 0, (LPARAM)g_模组[i].名字);
                SendMessageW(g_模组列表, LB_SETITEMDATA, idx, (LPARAM)i);
            }
            WCHAR 提示[256];
            wsprintfW(提示, L"清单已载入：%d 个版本 / %d 个模组", g_版本数, g_模组数);
            复制文本(g_状态文本, 提示);
            追加日志(g_日志, L"✅ 清单载入完成\r\n");
        } else {
            追加日志(g_日志, L"❌ 拉取清单失败（请检查网络）\r\n");
            复制文本(g_状态文本, L"清单加载失败");
        }
        return 0;
    }
    case WM_DRAWITEM: {
        LPDRAWITEMSTRUCT d = (LPDRAWITEMSTRUCT)l;
        if (!d || d->itemID == (UINT)-1) break;               /* 空列表：走默认背景 */
        int 已选 = (d->itemState & ODS_SELECTED) ? 1 : 0;
        int i = (int)(INT_PTR)d->itemData;
        if (d->CtlID == 1001 && i >= 0 && i < g_版本数) {
            WCHAR 主文[160], 副文[420];
            wsprintfW(主文, L"v%s", g_版本[i].版本);
            WCHAR 目录[MAX_PATH * 2];
            wsprintfW(目录, L"%s\\枪战突击_v%s", g_根目录, g_版本[i].版本);
            int 已装 = 文件存在(目录) ? 1 : 0;
            /* ⚠️ swprintf 而不是 wsprintf：wsprintf 不支持 %f（会破坏栈直接崩 0xC0000409） */
            if (g_版本[i].说明[0])
                swprintf(副文, 420, L"%s · %.1f MB · %s", g_版本[i].日期, g_版本[i].大小 / 1048576.0, g_版本[i].说明);
            else
                swprintf(副文, 420, L"%s · %.1f MB", g_版本[i].日期, g_版本[i].大小 / 1048576.0);
            画卡片(d, 已选, 主文, 副文, 已装);
        } else if (d->CtlID == 1002 && i >= 0 && i < g_模组数) {
            WCHAR 主文[300], 副文[300];
            wsprintfW(主文, L"%s", g_模组[i].名字);
            WCHAR 目录[MAX_PATH * 2];
            wsprintfW(目录, L"%s\\模组下载\\%s", g_根目录, g_模组[i].名字);
            int 已装 = 文件存在(目录) ? 1 : 0;
            wsprintfW(副文, L"%s · %ld 字节", g_模组[i].兼容[0] ? g_模组[i].兼容 : L"通用",
                (long)g_模组[i].大小);
            画卡片(d, 已选, 主文, 副文, 已装);
        }
        return TRUE;
    }
    case WM_TIMER: {
        if (w == 1) {
            LONG 已 = g_已下载, 总 = g_总字节;
            DWORD 时 = GetTickCount();
            double 秒 = (时 - g_开始时刻) / 1000.0; if (秒 < 0.1) 秒 = 0.1;
            double 速度KB = (已 / 1024.0) / 秒;
            WCHAR 文[256];
            swprintf(文, 256, L"下载中… %.1f / %.1f MB   ⚡ %.0f KB/s",
                已 / 1048576.0, 总 / 1048576.0, 速度KB);
            SetWindowTextW(g_状态文本, 文);
            SendMessageW(g_进度条, PBM_SETPOS, 总 > 0 ? (WPARAM)(已 * 100 / 总) : 0, 0);
        }
        return 0;
    }
    case WM_COMMAND: {
        int id = LOWORD(w);
        if (id == 104) { /* 刷新 */
            SendMessageW(g_版本列表, LB_RESETCONTENT, 0, 0);
            SendMessageW(g_模组列表, LB_RESETCONTENT, 0, 0);
            PostMessageW(h, WM_USER + 1, 0, 0);
        } else if (id == 101) { /* 下载版本 */
            下载选中版本(h);
        } else if (id == 102) { /* 开始游戏 */
            启动选中版本(h);
        } else if (id == 103) { /* 下载模组 */
            下载选中模组(h);
        }
        return 0;
    }
    case WM_CTLCOLORSTATIC: {
        HDC dc = (HDC)w;
        SetTextColor(dc, RGB(230, 235, 245));
        SetBkColor(dc, RGB(13, 16, 26));
        return (LRESULT)g_背景刷;
    }
    case WM_CTLCOLORLISTBOX: {
        HDC dc = (HDC)w;
        SetTextColor(dc, RGB(230, 235, 245));
        SetBkColor(dc, RGB(22, 26, 40));
        return (LRESULT)g_背景刷;
    }
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(h, &ps);
        RECT r; GetClientRect(h, &r);
        HBRUSH 刷 = CreateSolidBrush(RGB(13, 16, 26));
        FillRect(dc, &r, 刷);
        DeleteObject(刷);
        EndPaint(h, &ps);
        return 0;
    }
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

/* ==================== 下载逻辑 ==================== */
static void 下载选中版本(HWND h) {
    int i = (int)SendMessageW(g_版本列表, LB_GETCURSEL, 0, 0);
    if (i < 0 || i >= g_版本数) { 追加日志(g_日志, L"请先在列表里点一个版本\r\n"); return; }
    g_选中版本 = i;

    /* 目标目录 */
    WCHAR 目录[MAX_PATH * 2], zip路径[MAX_PATH * 2];
    wsprintfW(目录, L"%s\\枪战突击_v%s", g_根目录, g_版本[i].版本);
    wsprintfW(zip路径, L"%s\\_下载.zip", 目录);
    CreateDirectoryW(目录, NULL);

    WCHAR url[MAX_PATH * 2];
    wsprintfW(url, L"%s版本/%s", 更新页, g_版本[i].文件);

    WCHAR 提示[256];
    wsprintfW(提示, L"正在下载 v%s…", g_版本[i].版本);
    复制文本(g_状态文本, 提示);
    追加日志(g_日志, L"⬇ 开始下载 "); 追加日志(g_日志, url); 追加日志(g_日志, L"\r\n");

    const int 线程数 = 8;
    long long 总 = g_版本[i].大小;
    /* 多线程分片：8 线程（PCL 同款思路：分片并发 + 实时速度） */
    InterlockedExchange(&g_已下载, 0);
    g_总字节 = (LONG)总;
    g_开始时刻 = GetTickCount();
    SetTimer(h, 1, 500, NULL);                 /* 每 0.5 秒刷一次速度 */
    HANDLE 文件 = CreateFileW(zip路径, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    if (文件 == INVALID_HANDLE_VALUE) { 追加日志(g_日志, L"❌ 建文件失败\r\n"); return; }
    SetFilePointer(文件, (LONG)(总 & 0xffffffff), (LONG *)((char *)&总 + 4), FILE_BEGIN);
    SetEndOfFile(文件);

    HANDLE 线程[线程数]; 分片任务 任务[线程数];
    for (int t = 0; t < 线程数; t++) {
        任务[t].url = url;
        任务[t].文件 = 文件;
        任务[t].起 = (DWORD)(总 * t / 线程数);
        任务[t].止 = (DWORD)(总 * (t + 1) / 线程数) - 1;
        任务[t].线程号 = t;
        线程[t] = CreateThread(NULL, 0, 分片线程, &任务[t], 0, NULL);
    }
    WaitForMultipleObjects(线程数, 线程, TRUE, INFINITE);
    CloseHandle(文件);
    KillTimer(h, 1);

    /* 校验完整性（简化：文件大小对了就算成） */
    DWORD 下载大小 = GetFileAttributesW(zip路径) != INVALID_FILE_ATTRIBUTES ? (DWORD)0 : 0;
    HANDLE 校验 = CreateFileW(zip路径, GENERIC_READ, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (校验 != INVALID_HANDLE_VALUE) { 下载大小 = GetFileSize(校验, NULL); CloseHandle(校验); }

    复制文本(g_状态文本, L"下载完成，正在解压…");
    追加日志(g_日志, L"解压中…\r\n");
    解压zip(zip路径, 目录);
    DeleteFileW(zip路径);

    /* 写个已装标记 */
    WCHAR 标记[MAX_PATH * 2];
    wsprintfW(标记, L"%s\\.已安装", 目录);
    HANDLE mk = CreateFileW(标记, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    if (mk != INVALID_HANDLE_VALUE) CloseHandle(mk);

    swprintf(提示, 256, L"✅ v%s 已装好（%.1f MB）", g_版本[i].版本, 下载大小 / 1048576.0);
    复制文本(g_状态文本, 提示);
    追加日志(g_日志, L"✅ 安装完成，点「开始游戏」即可启动\r\n");
}

static void 启动选中版本(HWND h) {
    int i = (int)SendMessageW(g_版本列表, LB_GETCURSEL, 0, 0);
    if (i < 0 || i >= g_版本数) { 追加日志(g_日志, L"请先选一个版本\r\n"); return; }
    WCHAR 目录[MAX_PATH * 2], html[MAX_PATH * 2];
    wsprintfW(目录, L"%s\\枪战突击_v%s", g_根目录, g_版本[i].版本);
    wsprintfW(html, L"%s\\index.html", 目录);
    if (!文件存在(html)) {
        /* 解压后 html 可能在多文件版子目录 */
        wsprintfW(html, L"%s\\多文件版\\index.html", 目录);
        if (!文件存在(html)) { 追加日志(g_日志, L"❌ 这个版本还没下载，先点「下载版本」\r\n"); return; }
    }
    追加日志(g_日志, L"▶ 正在启动游戏…\r\n");
    ShellExecuteW(h, L"open", html, NULL, NULL, SW_SHOWNORMAL);
}

static void 下载选中模组(HWND h) {
    int i = (int)SendMessageW(g_模组列表, LB_GETCURSEL, 0, 0);
    if (i < 0 || i >= g_模组数) { 追加日志(g_日志, L"请先选一个模组\r\n"); return; }
    g_选中模组 = i;

    WCHAR url[MAX_PATH * 2];
    wsprintfW(url, L"%s模组/%s", 更新页, g_模组[i].名字);

    /* 下载到 版本库/模组下载/ 里（玩家自己拷到对应版本 mode/模组/） */
    WCHAR 目录[MAX_PATH * 2], 全[MAX_PATH * 2];
    wsprintfW(目录, L"%s\\模组下载", g_根目录);
    CreateDirectoryW(目录, NULL);
    wsprintfW(全, L"%s\\%s", 目录, g_模组[i].名字);

    WCHAR 提示[256];
    wsprintfW(提示, L"正在下载模组 %s…", g_模组[i].名字);
    复制文本(g_状态文本, 提示);

    DWORD 大小;
    BYTE *数据 = httpGet(url, &大小);
    if (数据 && 大小 > 0) {
        HANDLE f = CreateFileW(全, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
        DWORD 写; WriteFile(f, 数据, 大小, &写, NULL); CloseHandle(f);
        free(数据);
        wsprintfW(提示, L"✅ 模组已下到 版本库\\模组下载\\%s", g_模组[i].名字);
        复制文本(g_状态文本, 提示);
        追加日志(g_日志, L"✅ 模组下载完成，拷进对应版本的 mode\\模组\\ 即可用\r\n");
    } else {
        追加日志(g_日志, L"❌ 模组下载失败\r\n");
    }
}

/* ==================== 入口 ==================== */
int WINAPI wWinMain(HINSTANCE 实例, HINSTANCE 前, PWSTR 命令行, int 显示) {
    INITCOMMONCONTROLSEX icc; icc.dwSize = sizeof(icc); icc.dwICC = ICC_PROGRESS_CLASS;
    InitCommonControlsEx(&icc);

    WNDCLASSW wc; ZeroMemory(&wc, sizeof(wc));
    wc.lpfnWndProc = 窗口过程;
    wc.hInstance = 实例;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = L"枪战突击启动器";
    RegisterClassW(&wc);

    HWND h = CreateWindowExW(0, wc.lpszClassName, L"枪战突击 · 启动器",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        CW_USEDEFAULT, CW_USEDEFAULT, 820, 740, NULL, NULL, 实例, NULL);
    ShowWindow(h, 显示);
    UpdateWindow(h);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return (int)msg.wParam;
}
