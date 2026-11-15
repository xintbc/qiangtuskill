/* ============================================================================
   本地服务.c —— 内置迷你 HTTP 服务器（只服务游戏目录，只监听 127.0.0.1）
   ----------------------------------------------------------------------------
   为什么需要它（这轮的真问题）：
     以前客户端把游戏目录映射成 `https://game.example/`（WebView2 虚拟主机）。
     页面变成 https 源 → 游戏里连服务器时协议被拼成 `wss://`（30_联机.js 里
     `location.protocol==='https:' ? 'wss' : 'ws'`），而游戏服务器是明文 ws://
     → 握手永远失败 = "客户端连不上服务器"。而且 https 源还会把 ws:// 当混合内容拦掉。

     改成 http://127.0.0.1:端口 之后：
       · 页面是 http 源 → ws:// 正常（局域网服务器也能连）
       · 127.0.0.1 被浏览器视为**安全上下文** → 麦克风/IndexedDB 照样能用
       · 不需要 WebView2 虚拟主机映射，也不新增任何外部依赖

   端口稳定性（关系到存档不丢）：
     localStorage 是按「源」隔离的，源里带端口 → 端口一变存档就"没了"。
     所以端口记在 `配置\端口.txt` 里，下次优先复用；被占用才换（极端情况）。
   ========================================================================= */
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <process.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <winhttp.h>
#include <shellapi.h>

#include "本地服务.h"

#pragma comment(lib, "ws2_32.lib")

static SOCKET        g_听 = INVALID_SOCKET;
static int           g_端口 = 0;
static WCHAR         g_根[MAX_PATH * 2] = { 0 };
static WCHAR         g_配置[MAX_PATH * 2] = { 0 };
static volatile LONG g_在跑 = 0;
static HANDLE        g_线程 = NULL;

/* ---------------------------------------------------------------- 小工具 */

static int 取MIME(const char *扩展名, char *出, int 容量)
{
    struct { const char *ext, *mime; } 表[] = {
        { "html", "text/html; charset=utf-8" },
        { "htm",  "text/html; charset=utf-8" },
        { "js",   "application/javascript; charset=utf-8" },
        { "mjs",  "application/javascript; charset=utf-8" },
        { "css",  "text/css; charset=utf-8" },
        { "json", "application/json; charset=utf-8" },
        { "txt",  "text/plain; charset=utf-8" },
        { "md",   "text/plain; charset=utf-8" },
        { "png",  "image/png" },
        { "jpg",  "image/jpeg" },
        { "jpeg", "image/jpeg" },
        { "gif",  "image/gif" },
        { "ico",  "image/x-icon" },
        { "svg",  "image/svg+xml" },
        { "webp", "image/webp" },
        { "mp3",  "audio/mpeg" },
        { "ogg",  "audio/ogg" },
        { "wav",  "audio/wav" },
        { "m4a",  "audio/mp4" },
        { "aac",  "audio/aac" },
        { "flac", "audio/flac" },
        { "mp4",  "video/mp4" },
        { "webm", "video/webm" },
        { "ttf",  "font/ttf" },
        { "woff", "font/woff" },
        { "woff2","font/woff2" },
        { "wasm", "application/wasm" },
        { "glb",  "model/gltf-binary" },
        { "gltf", "model/gltf+json" },
    };
    for (int i = 0; i < (int)(sizeof(表) / sizeof(表[0])); i++) {
        if (lstrcmpiA(扩展名, 表[i].ext) == 0) { lstrcpynA(出, 表[i].mime, 容量); return 1; }
    }
    lstrcpynA(出, "application/octet-stream", 容量);
    return 0;
}

/* URL 里的 %XX 解回字节（中文文件名要走这条路） */
static void URL解码(char *s)
{
    char *读 = s, *写 = s;
    while (*读) {
        if (*读 == '%' && 读[1] && 读[2]) {
            int 高 = 读[1] <= '9' ? 读[1] - '0' : (读[1] | 32) - 'a' + 10;
            int 低 = 读[2] <= '9' ? 读[2] - '0' : (读[2] | 32) - 'a' + 10;
            if (高 >= 0 && 高 < 16 && 低 >= 0 && 低 < 16) {
                *写++ = (char)((高 << 4) | 低);
                读 += 3;
                continue;
            }
        }
        if (*读 == '+') { *写++ = ' '; 读++; continue; }
        *写++ = *读++;
    }
    *写 = 0;
}

static void 发全部(SOCKET 客, const char *数据, int 长度)
{
    int 已 = 0;
    while (已 < 长度) {
        int n = send(客, 数据 + 已, 长度 - 已, 0);
        if (n <= 0) return;
        已 += n;
    }
}

static void 回文本(SOCKET 客, int 码, const char *原因, const char *文本)
{
    char 头[512];
    int n = _snprintf(头, sizeof(头) - 1,
        "HTTP/1.1 %d %s\r\nContent-Type: text/plain; charset=utf-8\r\n"
        "Content-Length: %d\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n%s",
        码, 原因, (int)strlen(文本), 文本);
    发全部(客, 头, n);
}

/* ============================================================================
   【1.9.55】客户端内升级
   ----------------------------------------------------------------------------
   GET /api/update/check  → {"ok":1,"now":"1.9.54","new":"1.9.55","need":1}
   GET /api/update/apply  → 立刻回 {"ok":1}，后台：下载官方安装程序 →
                            用「/S <当前安装目录> /等待 <本进程pid> /启动」静默安装
   ★ 只装回**当前这个目录**（从自己的 exe 路径反推），绝不改到 C 盘默认目录
   ★ 装完自动启动新版本，旧进程先退出（/等待 会等它）

   版本号从 index.html 里的 ?v= 读 —— 安装包每次都会覆盖 index.html，
   所以它天然就是"本地版本"，不需要额外维护版本文件。
   ========================================================================= */
/* 【1.9.59】更新源：GitHub Pages 的构建偶尔会卡住（实测推完 25 分钟，
   新安装包在 github.io 上仍 404、清单还是旧版本），而 raw.githubusercontent.com
   是实时的。所以每次检查都问这两个源，取版本号更高的那个。 */
typedef struct { const WCHAR *主机; const WCHAR *基路径; } 更新源;
static const 更新源 更新源表[] = {
    { L"raw.githubusercontent.com", L"/xintbc/qiangtuskill/main/docs" },
    { L"xintbc.github.io",          L"/qiangtuskill" }
};
#define 更新源数 ((int)(sizeof(更新源表) / sizeof(更新源表[0])))

/* 兜底：安装器会在安装目录写 版本.txt（内容就是版本号）。
   index.html 被别人换成不带 ?v= 的版本时，靠它保证界面不会显示「未知」。 */
static void 取版本文件(char *出, int 容量)
{
    WCHAR exe[MAX_PATH * 2];
    GetModuleFileNameW(NULL, exe, MAX_PATH * 2);
    WCHAR *斜 = wcsrchr(exe, L'\\');
    if (斜) *斜 = 0;
    WCHAR 文件[MAX_PATH * 2];
    _snwprintf(文件, MAX_PATH * 2 - 1, L"%s\\版本.txt", exe);
    FILE *g = _wfopen(文件, L"rb");
    if (!g) return;
    char b[128] = { 0 };
    int n = (int)fread(b, 1, sizeof(b) - 1, g);
    fclose(g);
    int k = 0;
    for (int i = 0; i < n && k < 容量 - 1; i++) {
        char ch = b[i];
        if ((ch >= '0' && ch <= '9') || ch == '.') 出[k++] = ch;
        else if (k > 0) break;
    }
    出[k] = 0;
}

static void 取本地版本(char *出, int 容量)
{
    出[0] = 0;
    WCHAR 路径[MAX_PATH * 2];
    _snwprintf(路径, MAX_PATH * 2 - 1, L"%s\\index.html", g_根);
    FILE *f = _wfopen(路径, L"rb");
    if (f) {
        static char 缓冲[131072];
        int 读 = (int)fread(缓冲, 1, sizeof(缓冲) - 1, f);
        fclose(f);
        if (读 > 0) {
            缓冲[读] = 0;
            char *p = strstr(缓冲, "?v=");
            if (p) {
                p += 3;
                int n = 0;
                while (p[n] && n < 容量 - 1 && ((p[n] >= '0' && p[n] <= '9') || p[n] == '.')) { 出[n] = p[n]; n++; }
                出[n] = 0;
            }
        }
    }
    if (!出[0]) 取版本文件(出, 容量);
}

static int 版本比(const char *a, const char *b)
{
    int a1 = 0, a2 = 0, a3 = 0, b1 = 0, b2 = 0, b3 = 0;
    sscanf(a, "%d.%d.%d", &a1, &a2, &a3);
    sscanf(b, "%d.%d.%d", &b1, &b2, &b3);
    if (a1 != b1) return a1 > b1 ? 1 : -1;
    if (a2 != b2) return a2 > b2 ? 1 : -1;
    if (a3 != b3) return a3 > b3 ? 1 : -1;
    return 0;
}

/* 从文本里找「前缀 + 版本号 + 后缀」，返回版本号最大的那个文件名（UTF-8） */
static int 找最新(const char *文, const char *前缀, const char *后缀,
                 char *出文件, int 文件容量, char *出版本, int 版本容量)
{
    int 有 = 0;
    const char *p = 文;
    size_t 前长 = strlen(前缀), 后长 = strlen(后缀);
    while ((p = strstr(p, 前缀)) != NULL) {
        const char *起 = p + 前长;
        const char *末 = strstr(起, 后缀);
        if (!末) { p++; continue; }
        int 版长 = (int)(末 - 起);
        if (版长 > 0 && 版长 < 32 && 版长 < 版本容量) {
            char 版[32] = { 0 };
            memcpy(版, 起, 版长);
            int 合法 = 1;
            for (int i = 0; i < 版长; i++) {
                if (!((版[i] >= '0' && 版[i] <= '9') || 版[i] == '.')) { 合法 = 0; break; }
            }
            if (合法 && (!有 || 版本比(版, 出版本) > 0)) {
                lstrcpynA(出版本, 版, 版本容量);
                int 全 = (int)(末 + 后长 - p);
                if (全 < 文件容量) { memcpy(出文件, p, 全); 出文件[全] = 0; }
                有 = 1;
            }
        }
        p++;
    }
    return 有;
}

/* WinHTTP GET，整包读进内存（manifest 或 安装程序） */
static char *Http取整(const WCHAR *主机, const WCHAR *路径, DWORD *出长, int 上限)
{
    *出长 = 0;
    HINTERNET 会 = WinHttpOpen(L"QZUpdate/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!会) return NULL;
    WinHttpSetTimeouts(会, 5000, 6000, 8000, 20000);

    HINTERNET 连 = WinHttpConnect(会, 主机, INTERNET_DEFAULT_HTTPS_PORT, 0);
    if (!连) { WinHttpCloseHandle(会); return NULL; }

    /* 反缓存：每次都在 URL 后面挂一个时间戳。
       WinHTTP 自己带磁盘缓存，而 GitHub Pages 的 Cache-Control 是 max-age=600 ——
       不加这一下，用户点「检查更新」十分钟内都看不到新版本。 */
    WCHAR 带戳[1400];
    _snwprintf(带戳, 1399, L"%s%c%lu", 路径,
        (wcschr(路径, L'?') ? L'&' : L'?'), (unsigned long)GetTickCount());
    HINTERNET 请 = WinHttpOpenRequest(连, L"GET", 带戳, NULL, WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
    if (!请) { WinHttpCloseHandle(连); WinHttpCloseHandle(会); return NULL; }

    static const WCHAR *NO缓存头 = L"Cache-Control: no-cache\r\nPragma: no-cache\r\n";

    
    char *结果 = NULL;
    if (WinHttpSendRequest(请, NO缓存头, (DWORD)-1L, WINHTTP_NO_REQUEST_DATA, 0, 0, 0)
        && WinHttpReceiveResponse(请, NULL)) {
        DWORD 码 = 0, 长 = sizeof(码);
        WinHttpQueryHeaders(请, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX, &码, &长, WINHTTP_NO_HEADER_INDEX);
        if (码 == 200) {
            char *缓 = (char *)malloc((size_t)上限);
            if (缓) {
                DWORD 总 = 0;
                for (;;) {
                    DWORD 本次 = 0;
                    if (总 >= (DWORD)上限 - 1) break;
                    if (!WinHttpReadData(请, 缓 + 总, (DWORD)上限 - 1 - 总, &本次) || 本次 == 0) break;
                    总 += 本次;
                }
                缓[总] = 0;
                结果 = 缓;
                *出长 = 总;
            }
        }
    }
    WinHttpCloseHandle(请);
    WinHttpCloseHandle(连);
    WinHttpCloseHandle(会);
    return 结果;
}

/* 问所有更新源，返回版本号最高的安装包信息；出源 = 是哪个源给的（下载时优先用它） */
/* 问更新源，**第一个成功的就直接用**（不再两个都问：那样要等两倍时间）。
   源表第一个是 raw.githubusercontent.com —— git 原始文件，永远实时；
   github.io 的 Pages 构建会卡住，只当 raw 连不上时的兜底。 */
static int 查最新安装包(char *出文件, int 文件容量, char *出版本, int 版本容量, int *出源)
{
    出文件[0] = 0;
    出版本[0] = 0;
    for (int i = 0; i < 更新源数; i++) {
        WCHAR 清单路径[512];
        _snwprintf(清单路径, 511, L"%s/manifest.json", 更新源表[i].基路径);
        DWORD 长 = 0;
        char *清单 = Http取整(更新源表[i].主机, 清单路径, &长, 1 << 20);
        if (!清单) continue;
        char 文件[512] = { 0 }, 版本[32] = { 0 };
        int 有 = 找最新(清单, "枪战突击_安装程序_v", ".exe",
                        文件, sizeof(文件), 版本, sizeof(版本));
        free(清单);
        if (!有) continue;
        lstrcpynA(出版本, 版本, 版本容量);
        lstrcpynA(出文件, 文件, 文件容量);
        if (出源) *出源 = i;
        return 1;
    }
    return 0;
}

static volatile LONG g_升级中 = 0;

static unsigned __stdcall 升级线程(void *参)
{
    (void)参;
    char 文件名[512] = { 0 }, 版本[32] = { 0 };
    int 源 = 0;
    if (!查最新安装包(文件名, sizeof(文件名), 版本, sizeof(版本), &源)) {
        InterlockedExchange(&g_升级中, 0);
        return 0;
    }

    /* 安装包在 <基路径>/版本/ 下；优先用给出新版的源，失败再换别的源 */
    DWORD 包长 = 0;
    char *包 = NULL;
    for (int 试 = 0; 试 < 更新源数 && !包; 试++) {
        int i = (源 + 试) % 更新源数;
        WCHAR 路径[1024];
        _snwprintf(路径, 1023, L"%s/版本/", 更新源表[i].基路径);
        int 基 = lstrlenW(路径);
        MultiByteToWideChar(CP_UTF8, 0, 文件名, -1, 路径 + 基, 1024 - 基);
        char *试包 = Http取整(更新源表[i].主机, 路径, &包长, 24 << 20);
        if (试包 && 包长 >= 100000) 包 = 试包;
        else { free(试包); 包长 = 0; }
    }
    if (!包 || 包长 < 100000) { free(包); InterlockedExchange(&g_升级中, 0); return 0; }

    WCHAR 临时目录[MAX_PATH * 2];
    GetTempPathW(MAX_PATH * 2 - 1, 临时目录);
    WCHAR 安装包[MAX_PATH * 2];
    _snwprintf(安装包, MAX_PATH * 2 - 1, L"%s枪战突击_更新包.exe", 临时目录);
    FILE *f = _wfopen(安装包, L"wb");
    if (!f) { free(包); InterlockedExchange(&g_升级中, 0); return 0; }
    fwrite(包, 1, 包长, f);
    fclose(f);
    free(包);

    /* 安装目录 = 本进程 exe 所在目录（不是「游戏」子目录） */
    WCHAR 自身[MAX_PATH * 2];
    GetModuleFileNameW(NULL, 自身, MAX_PATH * 2);
    WCHAR *斜 = wcsrchr(自身, L'\\');
    if (斜) *斜 = 0;

    WCHAR 参数[MAX_PATH * 4];
    _snwprintf(参数, MAX_PATH * 4 - 1, L"/S \"%s\" /等待 %lu /启动",
        自身, (unsigned long)GetCurrentProcessId());

    SHELLEXECUTEINFOW 信;
    ZeroMemory(&信, sizeof(信));
    信.cbSize = sizeof(信);
    信.fMask = SEE_MASK_NOCLOSEPROCESS;
    信.lpVerb = L"open";
    信.lpFile = 安装包;
    信.lpParameters = 参数;
    信.nShow = SW_SHOWNORMAL;
    if (ShellExecuteExW(&信)) {
        Sleep(700);
        ExitProcess(0);            /* 主动退出，让 /等待 立刻生效 */
    }
    InterlockedExchange(&g_升级中, 0);
    return 0;
}

/* 生成 check 的 JSON（会联网，前端要显示"正在检查…"） */
static int 更新检查JSON(char *出, int 容量)
{
    char 现在[32] = { 0 };
    取本地版本(现在, sizeof(现在));

    char 文件名[512] = { 0 }, 版本[32] = { 0 };
    int 有 = 查最新安装包(文件名, sizeof(文件名), 版本, sizeof(版本), NULL);
    if (!有) {
        _snprintf(出, 容量 - 1,
            "{\"ok\":0,\"err\":\"连不上更新服务器（raw / github.io 都不通）\",\"now\":\"%s\"}", 现在);
        return 0;
    }
    int 要 = 现在[0] ? (版本比(版本, 现在) > 0) : 1;
    _snprintf(出, 容量 - 1,
        "{\"ok\":1,\"now\":\"%s\",\"new\":\"%s\",\"need\":%d,\"file\":\"%s\"}",
        现在[0] ? 现在 : "未知", 版本, 要 ? 1 : 0, 文件名);
    return 1;
}

/* 处理一个连接：解析请求行 → 映射到文件 → 返回（支持 Range，视频要 seek） */
static unsigned __stdcall 处理连接(void *参)
{
    SOCKET 客 = (SOCKET)(UINT_PTR)参;
    char 请求[4096] = { 0 };
    int 收 = recv(客, 请求, sizeof(请求) - 1, 0);
    if (收 <= 0) { closesocket(客); return 0; }

    /* 取第一行：GET /path HTTP/1.1 */
    char 方法[8] = { 0 }, 路径[2048] = { 0 };
    if (sscanf(请求, "%7s %2047s", 方法, 路径) != 2) { closesocket(客); return 0; }
    if (lstrcmpiA(方法, "GET") != 0 && lstrcmpiA(方法, "HEAD") != 0) {
        回文本(客, 405, "Method Not Allowed", "only GET/HEAD");
        closesocket(客); return 0;
    }
    if (lstrcmpiA(方法, "HEAD") == 0) { 方法[0] = 'H'; }

    URL解码(路径);
    /* 去掉查询串 */
    char *问 = strchr(路径, '?');
    if (问) *问 = 0;
    if (路径[0] != '/') { 回文本(客, 400, "Bad Request", "bad path"); closesocket(客); return 0; }
    if (lstrlenA(路径) > 1 && 路径[lstrlenA(路径) - 1] == '/') lstrcatA(路径, "index.html");

    /* 【1.9.55】客户端内升级：查版本 / 下载安装 */
    if (lstrcmpiA(路径, "/api/update/check") == 0) {
        static char 回包[4096];
        static volatile LONG 锁 = 0;
        if (InterlockedCompareExchange(&锁, 1, 0) != 0) {
            回文本(客, 503, "Busy", "{\"ok\":0,\"err\":\"正在检查，请稍候\"}");
            closesocket(客); return 0;
        }
        更新检查JSON(回包, sizeof(回包));
        回文本(客, 200, "OK", 回包);
        InterlockedExchange(&锁, 0);
        closesocket(客); return 0;
    }
    if (lstrcmpiA(路径, "/api/update/apply") == 0) {
        if (InterlockedCompareExchange(&g_升级中, 1, 0) == 0) {
            HANDLE t = (HANDLE)_beginthreadex(NULL, 0, 升级线程, NULL, 0, NULL);
            if (t) CloseHandle(t); else InterlockedExchange(&g_升级中, 0);
        }
        回文本(客, 200, "OK", "{\"ok\":1,\"started\":1}");
        closesocket(客); return 0;
    }

    /* 路径安全：不允许 .. 穿越 */
    if (strstr(路径, "..")) { 回文本(客, 403, "Forbidden", "no .."); closesocket(客); return 0; }

    char 相对A[2048];
    lstrcpynA(相对A, 路径 + 1, 2048);
    for (char *p = 相对A; *p; p++) if (*p == '/') *p = '\\';

    WCHAR 相对W[2048] = { 0 };
    MultiByteToWideChar(CP_UTF8, 0, 相对A, -1, 相对W, 2048);
    WCHAR 全[MAX_PATH * 2];
    _snwprintf(全, MAX_PATH * 2 - 1, L"%s\\%s", g_根, 相对W);

    HANDLE f = CreateFileW(全, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
        NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) {
        回文本(客, 404, "Not Found", "404");
        closesocket(客); return 0;
    }

    LARGE_INTEGER 大小;
    GetFileSizeEx(f, &大小);

    /* 扩展名 */
    const char *点 = strrchr(相对A, '.');
    char mime[128];
    取MIME(点 ? 点 + 1 : "", mime, sizeof(mime));

    /* 【batch276】静态资源缓存：以前一律 no-cache，每次进游戏都要把 1.6MB 分片重下一遍
       （客户端还是 Connection: close，等于 33 次重新握手）—— 这就是"JS 加载慢/加载不出来"的根因。
       html 仍然 no-cache（换版本立刻生效），js/css 的 URL 都带 ?v= 版本号 → 可以长期缓存。 */
    const char *缓存 = "public, max-age=604800";
    /* 【1.9.43】no-cache 只是"要重新验证"，WebView2 实测仍可能直接用旧页 —— 页面一旧，
       它引用的还是旧 ?v= 的 js（immutable），整个客户端就卡在老版本（1.9.42 踩过）。
       no-store ＝ 根本不存，每次启动都拿最新 html；js/css 依旧 immutable 不受影响。 */
    if (strstr(mime, "text/html")) 缓存 = "no-store, max-age=0";
    else if (strstr(mime, "javascript") || strstr(mime, "text/css")) 缓存 = "public, max-age=31536000, immutable";

    /* Range 支持：Range: bytes=起-止 */
    long long 起 = 0, 止 = 大小.QuadPart - 1;
    int 有范围 = 0;
    const char *r = strstr(请求, "Range: bytes=");
    if (!r) r = strstr(请求, "range: bytes=");
    if (r && 大小.QuadPart > 0) {
        long long a = 0, b = 0;
        int 个数 = sscanf(r + 13, "%lld-%lld", &a, &b);
        if (个数 >= 2 && a <= b) { 起 = a; 止 = b; 有范围 = 1; }
        else if (个数 == 2 && r[13] == '-') { /* bytes=-N 尾部 */ }
        else if (个数 == 1) { 起 = a; 有范围 = 1; }
        if (起 < 0) 起 = 0;
        if (止 >= 大小.QuadPart) 止 = 大小.QuadPart - 1;
    }

    char 头[1024];
    int 头长;
    if (有范围) {
        头长 = _snprintf(头, sizeof(头) - 1,
            "HTTP/1.1 206 Partial Content\r\nContent-Type: %s\r\n"
            "Content-Range: bytes %lld-%lld/%lld\r\nContent-Length: %lld\r\n"
            "Accept-Ranges: bytes\r\nConnection: close\r\nCache-Control: %s\r\n\r\n",
            mime, 起, 止, (long long)大小.QuadPart, 止 - 起 + 1, 缓存);
        /* ⚠️ 参数顺序必须跟格式串一一对应：%s(mime) → %lld-%lld/%lld → %lld → %s(缓存)。
           以前把「缓存」写在第二个位置，结果 %lld 拿到指针、末尾 %s 拿到文件大小当地址解引用
           → 0xC0000005 访问冲突，客户端一进游戏就闪退（1.9.30 的事故）。 */
        LARGE_INTEGER 定位; 定位.QuadPart = 起;
        SetFilePointerEx(f, 定位, NULL, FILE_BEGIN);
    } else {
        头长 = _snprintf(头, sizeof(头) - 1,
            "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %lld\r\n"
            "Accept-Ranges: bytes\r\nConnection: close\r\nCache-Control: %s\r\n\r\n",
            mime, (long long)大小.QuadPart, 缓存);
        起 = 0;
    }
    发全部(客, 头, 头长);

    if (方法[0] != 'H') {   /* HEAD 只回头 */
        long long 还剩 = 止 - 起 + 1;
        char *块 = (char *)malloc(65536);
        if (块) {
            while (还剩 > 0) {
                DWORD 要 = (DWORD)(还剩 > 65536 ? 65536 : 还剩), 读 = 0;
                if (!ReadFile(f, 块, 要, &读, NULL) || 读 == 0) break;
                发全部(客, 块, (int)读);
                还剩 -= 读;
            }
            free(块);
        }
    }
    CloseHandle(f);
    closesocket(客);
    return 0;
}

/* 监听线程 */
static unsigned __stdcall 监听线程(void *参)
{
    (void)参;
    while (InterlockedCompareExchange(&g_在跑, 1, 1) == 1) {
        SOCKET 客 = accept(g_听, NULL, NULL);
        if (客 == INVALID_SOCKET) {
            if (InterlockedCompareExchange(&g_在跑, 1, 1) != 1) break;
            Sleep(20);
            continue;
        }
        HANDLE t = (HANDLE)_beginthreadex(NULL, 0, 处理连接, (void *)(UINT_PTR)客, 0, NULL);
        if (t) CloseHandle(t);
        else closesocket(客);
    }
    return 0;
}

/* 端口记录文件（保证下次还是同一个源 → 存档不丢） */
static void 读端口记录(void)
{
    if (!g_配置[0]) return;
    WCHAR 路径[MAX_PATH * 2];
    _snwprintf(路径, MAX_PATH * 2 - 1, L"%s\\端口.txt", g_配置);
    FILE *f = _wfopen(路径, L"rb");
    if (!f) return;
    int 端口 = 0;
    if (fscanf(f, "%d", &端口) == 1 && 端口 > 1023 && 端口 < 65536) g_端口 = 端口;
    fclose(f);
}

static void 写端口记录(int 端口)
{
    if (!g_配置[0]) return;
    CreateDirectoryW(g_配置, NULL);
    WCHAR 路径[MAX_PATH * 2];
    _snwprintf(路径, MAX_PATH * 2 - 1, L"%s\\端口.txt", g_配置);
    FILE *f = _wfopen(路径, L"wb");
    if (!f) return;
    fprintf(f, "%d", 端口);
    fclose(f);
}

/* ---------------------------------------------------------------- 对外 */

/* 【batch269】试在指定端口上监听；成功返回 1（g_听 / g_端口 已设好） */
static int 试绑定(int 端口)
{
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return 0;
    int 开 = 1;
    setsockopt(s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char *)&开, sizeof(开));

    struct sockaddr_in 地址;
    ZeroMemory(&地址, sizeof(地址));
    地址.sin_family = AF_INET;
    地址.sin_port = htons((unsigned short)端口);
    地址.sin_addr.s_addr = inet_addr("127.0.0.1");

    if (bind(s, (struct sockaddr *)&地址, sizeof(地址)) == 0 && listen(s, 16) == 0) {
        g_听 = s;
        g_端口 = 端口;
        return 1;
    }
    closesocket(s);
    return 0;
}

int 本地服务_启动(const WCHAR *根目录, const WCHAR *配置目录)
{
    lstrcpynW(g_根, 根目录, MAX_PATH * 2);
    lstrcpynW(g_配置, 配置目录 ? 配置目录 : L"", MAX_PATH * 2);

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 0;

    读端口记录();

    /* 【batch269】先「死等」记住的端口 —— 端口一变，浏览器源就变
       （http://127.0.0.1:端口），localStorage 立刻读不到，玩家眼里就是
       "管理员解锁 / 枪皮 / 通关记录 / 名字全没了"。
       实测客户端旧存档里出现过 39001~39004 四个源 —— 就是端口漂移造成的。
       刚关掉的客户端进程可能还没退干净、端口还占着，这里等最多 ~6 秒再考虑换。 */
    int 记住的 = g_端口;
    int 起点 = 记住的 > 0 ? 记住的 : 本地服务默认端口;
    if (记住的 > 0) {
        for (int 等 = 0; 等 < 15 && g_听 == INVALID_SOCKET; 等++) {
            if (试绑定(记住的)) break;
            Sleep(400);
        }
    }
    /* 还被占（另一个客户端在跑 / 别的程序占了这个端口）→ 才往后换，并记进日志 */
    for (int i = 0; i < 40 && g_听 == INVALID_SOCKET; i++) {
        int 试 = 起点 + i;
        if (试 > 65500) break;
        if (试 == 记住的) continue;            /* 刚才已经等过了 */
        试绑定(试);
    }

    if (g_听 == INVALID_SOCKET) { WSACleanup(); return 0; }

    写端口记录(g_端口);
    InterlockedExchange(&g_在跑, 1);
    g_线程 = (HANDLE)_beginthreadex(NULL, 0, 监听线程, NULL, 0, NULL);
    return g_端口;
}

int 本地服务_端口(void) { return g_端口; }

void 本地服务_停止(void)
{
    InterlockedExchange(&g_在跑, 0);
    if (g_听 != INVALID_SOCKET) {
        closesocket(g_听);
        g_听 = INVALID_SOCKET;
    }
    if (g_线程) { WaitForSingleObject(g_线程, 1500); CloseHandle(g_线程); g_线程 = NULL; }
    WSACleanup();
}
