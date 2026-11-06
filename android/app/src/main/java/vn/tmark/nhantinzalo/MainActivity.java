package vn.tmark.nhantinzalo;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    static final String ZALO_PACKAGE = "com.zing.zalo";
    private static final int REQ_PICK = 1001;
    private static final int REQ_EXPORT = 1002;
    private byte[] pendingExport;

    static WeakReference<MainActivity> current = new WeakReference<>(null);

    private WebView web;
    private Uri fileUri;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = new WeakReference<>(this);
        js("window.__onResume && window.__onResume()");
    }

    void js(String code) {
        runOnUiThread(() -> web.evaluateJavascript(code, null));
    }

    void deliverResult(String jobId, boolean ok, String error) {
        js("window.__onSendResult && window.__onSendResult(" + JSONObject.quote(jobId) + "," + ok + ","
                + JSONObject.quote(error == null ? "" : error) + ")");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_EXPORT) {
            finishExport(resultCode == RESULT_OK && data != null ? data.getData() : null);
            return;
        }
        if (requestCode != REQ_PICK) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            js("window.__onFilePicked && window.__onFilePicked(null)");
            return;
        }
        Uri uri = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {
        }
        new Thread(() -> {
            try {
                byte[] bytes = readAll(uri);
                fileUri = uri;
                String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                js("window.__onFilePicked && window.__onFilePicked(" + JSONObject.quote(displayName(uri)) + ","
                        + JSONObject.quote(b64) + ")");
            } catch (Exception e) {
                js("window.__onFilePicked && window.__onFilePicked(null,null," + JSONObject.quote("Không đọc được file: " + e.getMessage()) + ")");
            }
        }).start();
    }

    private byte[] readAll(Uri uri) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
        }
        String p = uri.getLastPathSegment();
        return p == null ? "khach_hang.xlsx" : p;
    }

    private void finishExport(Uri uri) {
        byte[] bytes = pendingExport;
        pendingExport = null;
        if (uri == null || bytes == null) {
            js("window.__onExportResult && window.__onExportResult(false, null)");
            return;
        }
        try (OutputStream os = getContentResolver().openOutputStream(uri, "wt")) {
            os.write(bytes);
            js("window.__onExportResult && window.__onExportResult(true, null)");
        } catch (Exception e) {
            js("window.__onExportResult && window.__onExportResult(false, " + JSONObject.quote("Không ghi được file: " + e.getMessage()) + ")");
        }
    }

    private void updateResult(String error) {
        js("window.__onUpdateResult && window.__onUpdateResult(" + (error == null ? "null" : JSONObject.quote(error)) + ")");
    }

    private void openInstaller(File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            updateResult("Hãy bật \"Cho phép cài ứng dụng\" cho Nhắn tin Zalo rồi bấm Cập nhật lại");
            return;
        }
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
        updateResult(null);
    }

    private class Bridge {

        @JavascriptInterface
        public void pickExcel() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/vnd.ms-excel",
                        "text/csv",
                        "text/comma-separated-values",
                        "application/octet-stream"
                });
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(i, REQ_PICK);
            });
        }

        @JavascriptInterface
        public String saveExcel(String b64) {
            if (fileUri == null) return "Chưa chọn file";
            try (OutputStream os = getContentResolver().openOutputStream(fileUri, "wt")) {
                os.write(Base64.decode(b64, Base64.DEFAULT));
                return "";
            } catch (Exception e) {
                return "Không ghi được file: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public boolean isServiceEnabled() {
            return ZaloAccessibilityService.instance != null;
        }

        @JavascriptInterface
        public void openAccessibilitySettings() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        }

        @JavascriptInterface
        public void exportExcel(String b64, String name) {
            pendingExport = Base64.decode(b64, Base64.DEFAULT);
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(name.endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                i.putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(i, REQ_EXPORT);
            });
        }

        @JavascriptInterface
        public void installUpdate(String url) {
            new Thread(() -> {
                try {
                    File dir = new File(getCacheDir(), "update");
                    dir.mkdirs();
                    File apk = new File(dir, "NhanTinZalo.apk");
                    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    } finally {
                        conn.disconnect();
                    }
                    runOnUiThread(() -> openInstaller(apk));
                } catch (Exception e) {
                    updateResult("Không tải được bản mới: " + e.getMessage());
                }
            }).start();
        }

        // Lỗi bắt đầu bằng "!" là lỗi nghiêm trọng, cần dừng cả lượt gửi
        @JavascriptInterface
        public String send(String jobId, String phone, String messagesJson, int delayMs) {
            ZaloAccessibilityService svc = ZaloAccessibilityService.instance;
            if (svc == null) return "!Chưa bật quyền Trợ năng cho app";
            if (getPackageManager().getLaunchIntentForPackage(ZALO_PACKAGE) == null) return "!Máy chưa cài Zalo";

            List<String> messages = new ArrayList<>();
            try {
                JSONArray arr = new JSONArray(messagesJson);
                for (int i = 0; i < arr.length(); i++) messages.add(arr.getString(i));
            } catch (Exception e) {
                return "Dữ liệu tin nhắn không hợp lệ";
            }

            svc.startJob(jobId, phone, messages, delayMs);
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://zalo.me/" + phone));
                i.setPackage(ZALO_PACKAGE);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (ActivityNotFoundException e) {
                svc.cancelJob();
                return "!Không mở được Zalo";
            }
            return "";
        }
    }
}
