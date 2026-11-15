package com.qiangtu.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.util.HashMap;

/**
 * 手机版客户端：一个只服务这款游戏的 WebView 壳。
 *
 * ⚠️ 代码里的标识符**必须全用英文**：d8（dex 编译器）碰到中文方法名/类名会在
 *    MainActivity$1$1.class 上抛 NullPointerException（实测，内部错误），整包编译失败。
 *    中文只出现在注释、界面文字、以及 @JavascriptInterface 暴露给页面的名字里
 *    —— 但那个名字也建议英文，免得又踩同一个坑。
 *
 * ── 为什么不直接 file:// 加载 ──
 *   file:// 下 fetch/XHR 被同源策略挡掉（模组加载会失败），部分存储 API 也不可用。
 *   这里让页面跑在 http://game.local/ 这个假域名上，由 shouldInterceptRequest 全部拦下来、
 *   直接从 assets 读文件给它 —— 浏览器眼里就是正常的 http 源，WebGL/ES6/fetch 照常，
 *   纯本地、不联网，也不需要 androidx（手工 aapt2 + d8 就能出 apk）。
 *
 * ── 模组 ──
 *   assets 里的模组只读；玩家自己装的放 App 私有目录 files/mods/。
 *   拦截 mode/模组/* 时先查 files/mods/，再回退 assets —— 装过的优先，删掉就回到内置。
 */
public class MainActivity extends Activity {

    /** 页面用的假域名：所有请求都在它下面，全部本地拦截 */
    private static final String HOST = "http://game.local";
    private static final int REQ_PICK_MOD = 1001;

    private WebView web;
    private long lastBackAt = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        goFullscreen();

        web = new WebView(this);
        web.setBackgroundColor(0xFF11141A);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                  // localStorage：存档、名字、身份码
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);                   // 不走 file://
        s.setMediaPlaybackRequiresUserGesture(false);  // 音效不用先点一下
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);   // 联机是 ws:// 明文
        }

        // 页面里调 window.gameClient.pickMod() 就能弹文件选择装模组
        web.addJavascriptInterface(new JsBridge(this), "gameClient");

        web.setWebViewClient(new MyClient(this));

        web.loadUrl(HOST + "/index.html");
        setContentView(web);
    }

    /**
     * 给页面用的桥。必须是**独立的具名类**，不能写成 `new Object(){ ... new Runnable(){...} }`：
     * 那种"匿名类里再套匿名类"会编译出 MainActivity$1$1.class，
     * d8（dex 编译器）在它上面直接抛 NullPointerException 内部错误，整包编译失败。
     */
    public static class JsBridge {
        private final MainActivity act;
        JsBridge(MainActivity a) { this.act = a; }

        @JavascriptInterface
        public void pickMod() { act.doPickMod(); }

        /* 【batch225】模组管理面板用的四条：列 / 读 / 写 / 删。
           名字全英文（d8 对中文标识符不稳），真正的中文只在界面文字里。
           文件都落在 files/mods/ —— 就是安卓这边的「Mods 文件夹」，
           shouldInterceptRequest 会优先读它，所以装完就能被页面加载到。 */
        @JavascriptInterface
        public String modList() { return act.listModsJson(); }

        @JavascriptInterface
        public String modRead(String name) { return act.readMod(name); }

        @JavascriptInterface
        public boolean modWrite(String name, String code) { return act.writeMod(name, code); }

        @JavascriptInterface
        public boolean modDelete(String name) { return act.deleteMod(name); }
    }

    /* ---- 模组文件读写 ---- */
    private File modsDir() {
        File d = new File(getFilesDir(), "mods");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** 文件名白名单：只留 .js、不许带路径分隔符 / ..，免得写到私有目录外面去 */
    private static String safeModName(String n) {
        if (n == null) return null;
        n = n.trim();
        if (n.length() == 0 || n.length() > 64) return null;
        if (!n.toLowerCase().endsWith(".js")) return null;
        if (n.indexOf('/') >= 0 || n.indexOf('\\') >= 0) return null;
        if (n.indexOf("..") >= 0) return null;
        for (int i = 0; i < n.length(); i++) {
            char c = n.charAt(i);
            boolean ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || c == '_' || c == '-' || c == '.' || c == ' ' || c == '(' || c == ')'
                    || (c >= 0x4E00 && c <= 0x9FFF);
            if (!ok) return null;
        }
        return n;
    }

    private static String jsonStr(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(' ');
            else b.append(c);
        }
        return b.append('"').toString();
    }

    /** 按文件名排个序，面板里看着稳当。
        ⚠️ 故意用 TreeMap 而不是自定义 Comparator：Comparator 得写成 static 类，
           而 d8 会为它多编一个 MainActivity$Xxx.class —— 打包脚本的 d8 命令行是
           逐个列 class 文件的，多一个就容易漏（漏了运行时 NoClassDefFoundError）。 */
    String listModsJson() {
        File[] fs = modsDir().listFiles();
        java.util.TreeMap<String, Long> map = new java.util.TreeMap<String, Long>();
        if (fs != null) {
            for (int i = 0; i < fs.length; i++) {
                File f = fs[i];
                if (f == null || !f.isFile()) continue;
                String n = f.getName();
                if (!n.toLowerCase().endsWith(".js")) continue;
                map.put(n, Long.valueOf(f.length()));
            }
        }
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (java.util.Map.Entry<String, Long> e : map.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"n\":").append(jsonStr(e.getKey()))
              .append(",\"s\":").append(e.getValue().longValue()).append('}');
        }
        return sb.append(']').toString();
    }

    String readMod(String name) {
        String n = safeModName(name);
        if (n == null) return "";
        File f = new File(modsDir(), n);
        if (!f.isFile()) return "";
        try {
            byte[] buf = new byte[(int) f.length()];
            FileInputStream in = new FileInputStream(f);
            int off = 0;
            while (off < buf.length) {
                int r = in.read(buf, off, buf.length - off);
                if (r <= 0) break;
                off += r;
            }
            in.close();
            return new String(buf, 0, off, "UTF-8");
        } catch (Exception e) { return ""; }
    }

    boolean writeMod(String name, String code) {
        String n = safeModName(name);
        if (n == null || code == null) return false;
        try {
            File dst = new File(modsDir(), n);
            FileOutputStream out = new FileOutputStream(dst);
            out.write(code.getBytes("UTF-8"));
            out.close();
            return true;
        } catch (Exception e) { return false; }
    }

    boolean deleteMod(String name) {
        String n = safeModName(name);
        if (n == null) return false;
        try {
            File f = new File(modsDir(), n);
            return f.isFile() && f.delete();
        } catch (Exception e) { return false; }
    }

    /** 切回 UI 线程再弹文件选择（结果回到 onActivityResult） */
    void doPickMod() { runOnUiThread(new PickTask(this)); }

    /**
     * ⚠️ 这里所有回调类都写成**具名 static 类**，不用匿名内部类：
     *    javac 会把 `new Xxx(){...}` 编成 MainActivity$1.class、$2.class，
     *    而 build-tools 34 自带的 d8（R8 8.2.2）在 $1 这类**匿名类**上会抛
     *    NullPointerException 内部错误（`String.length()` 参数为 null），整包编译失败。
     *    改成具名类就没有 $数字 后缀的 class，d8 正常处理。
     */
    static class PickTask implements Runnable {
        private final MainActivity act;
        PickTask(MainActivity a) { act = a; }
        public void run() { act.openFilePicker(); }
    }

    static class MyClient extends WebViewClient {
        private final MainActivity act;
        MyClient(MainActivity a) { act = a; }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            return act.localResponse(req.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            // 只允许留在自己的假域名里，任何外链都不跳（"只能打开这个游戏"）
            return !req.getUrl().toString().startsWith(HOST);
        }
    }

    // ------------------------------------------------------------ 本地资源

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".mp4")) return "video/mp4";
        if (p.endsWith(".glb")) return "model/gltf-binary";
        if (p.endsWith(".gltf")) return "model/gltf+json";
        if (p.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    /** 先找玩家装的（files/mods/），再回退到内置 assets */
    private InputStream openAsset(String rel) {
        final String modPrefix = "mode/模组/";
        if (rel.startsWith(modPrefix)) {
            String name = rel.substring(modPrefix.length());
            File f = new File(getFilesDir(), "mods/" + name);
            if (f.isFile()) {
                try { return new FileInputStream(f); } catch (IOException e) { /* 落到 assets */ }
            }
        }
        try { return getAssets().open(rel); } catch (IOException e) { return null; }
    }

    private WebResourceResponse localResponse(Uri uri) {
        if (uri == null || uri.getHost() == null) return null;
        if (!"game.local".equals(uri.getHost())) return null;

        String path = uri.getPath();
        if (path == null || "/".equals(path)) path = "/index.html";
        String rel = path.startsWith("/") ? path.substring(1) : path;
        try { rel = URLDecoder.decode(rel, "UTF-8"); } catch (Exception e) { }

        InputStream in = openAsset(rel);
        if (in == null) {
            String body = "<html><body style='font:14px sans-serif;background:#12141a;color:#ccc'>"
                    + "<h3>404</h3><p>手机版里没有这个文件：" + rel + "</p></body></html>";
            return new WebResourceResponse("text/html", "utf-8",
                    new ByteArrayInputStream(body.getBytes()));
        }
        HashMap<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mimeOf(rel), null, 200, "OK", headers, in);
    }

    // ------------------------------------------------------------ 装模组

    private void openFilePicker() {
        Intent it = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        it.addCategory(Intent.CATEGORY_OPENABLE);
        it.setType("*/*");                     // 有些文件管理器不认 application/javascript
        try { startActivityForResult(it, REQ_PICK_MOD); }
        catch (Exception e) { Toast.makeText(this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show(); }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK_MOD || resultCode != RESULT_OK || data == null) return;
        Uri src = data.getData();
        if (src == null) return;

        String name = "mod.js";
        try {
            String last = src.getLastPathSegment();
            if (last != null) {
                int slash = last.lastIndexOf('/');
                name = slash >= 0 ? last.substring(slash + 1) : last;
            }
        } catch (Exception e) { }
        if (!name.toLowerCase().endsWith(".js")) name = name + ".js";

        try {
            File dir = new File(getFilesDir(), "mods");
            if (!dir.exists()) dir.mkdirs();
            File dst = new File(dir, name);
            InputStream in = getContentResolver().openInputStream(src);
            FileOutputStream out = new FileOutputStream(dst);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.close();
            in.close();

            Toast.makeText(this, "已安装模组：" + name + "\n正在重新加载…", Toast.LENGTH_LONG).show();
            web.reload();
        } catch (Exception e) {
            Toast.makeText(this, "安装失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    // ------------------------------------------------------------ 全屏 / 生命周期

    private void goFullscreen() {
        View root = getWindow().getDecorView();
        root.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goFullscreen();
    }

    /** 返回键：先回主菜单，再按一次才退出（防误触） */
    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBackAt < 2000) { super.onBackPressed(); return; }
        lastBackAt = now;
        Toast.makeText(this, "再按一次返回退出游戏", Toast.LENGTH_SHORT).show();
        web.evaluateJavascript("try{location.href='index.html';}catch(e){}", null);
    }

    @Override
    protected void onPause() { super.onPause(); if (web != null) web.onPause(); }

    @Override
    protected void onResume() {
        super.onResume();
        goFullscreen();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
