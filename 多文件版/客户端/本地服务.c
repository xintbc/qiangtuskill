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
#include <string.h>

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
            "Accept-Ranges: bytes\r\nConnection: close\r\nCache-Control: no-cache\r\n\r\n",
            mime, 起, 止, (long long)大小.QuadPart, 止 - 起 + 1);
        LARGE_INTEGER 定位; 定位.QuadPart = 起;
        SetFilePointerEx(f, 定位, NULL, FILE_BEGIN);
    } else {
        头长 = _snprintf(头, sizeof(头) - 1,
            "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %lld\r\n"
            "Accept-Ranges: bytes\r\nConnection: close\r\nCache-Control: no-cache\r\n\r\n",
            mime, (long long)大小.QuadPart);
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

int 本地服务_启动(const WCHAR *根目录, const WCHAR *配置目录)
{
    lstrcpynW(g_根, 根目录, MAX_PATH * 2);
    lstrcpynW(g_配置, 配置目录 ? 配置目录 : L"", MAX_PATH * 2);

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 0;

    读端口记录();

    /* 先试记住的端口（源稳定 → 存档延续），失败再往后找 */
    int 起点 = g_端口 > 0 ? g_端口 : 本地服务默认端口;
    for (int i = 0; i < 40; i++) {
        int 试 = 起点 + i;
        if (试 > 65500) break;
        SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (s == INVALID_SOCKET) continue;
        int 开 = 1;
        setsockopt(s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char *)&开, sizeof(开));

        struct sockaddr_in 地址;
        ZeroMemory(&地址, sizeof(地址));
        地址.sin_family = AF_INET;
        地址.sin_port = htons((unsigned short)试);
        地址.sin_addr.s_addr = inet_addr("127.0.0.1");

        if (bind(s, (struct sockaddr *)&地址, sizeof(地址)) == 0 && listen(s, 16) == 0) {
            g_听 = s;
            g_端口 = 试;
            break;
        }
        closesocket(s);
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
