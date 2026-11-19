package com.edusphere.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends Activity {
    private static final int MEDIA_PERMISSION_REQUEST = 41;
    private static final int FILE_CHOOSER_REQUEST = 42;
    private WebView webView;
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> fileCallback;
    private FrameLayout rootLayout;
    private View splashView;
    private boolean splashFinished = false;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        rootLayout = new FrameLayout(this);
        webView = new WebView(this);
        rootLayout.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        splashView = createSplashView();
        rootLayout.addView(splashView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(rootLayout);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && (host.equals("tejaswase-glitch.github.io") || host.endsWith(".jitsi.net") || host.equals("meet.jit.si") || host.equals("8x8.vc"))) return false;
                if ("https".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (Exception ignored) { }
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean camera = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                    boolean mic = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                    if (camera && mic) request.grant(request.getResources());
                    else {
                        pendingWebPermission = request;
                        ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, MEDIA_PERMISSION_REQUEST);
                    }
                });
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST); }
                catch (Exception e) { fileCallback = null; return false; }
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("User-Agent", userAgent);
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                request.setMimeType(mimeType);
                request.setTitle("EduSphere download");
                request.setDescription("Downloading learning content");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "EduSphere-" + System.currentTimeMillis());
                ((DownloadManager)getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
                Toast.makeText(this, "Download started", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Unable to download this file", Toast.LENGTH_LONG).show();
            }
        });

        if (savedInstanceState == null) webView.loadUrl("https://tejaswase-glitch.github.io/edusphere/");
        else webView.restoreState(savedInstanceState);

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (splashView != null && !isFinishing()) {
                rootLayout.removeView(splashView);
                splashView = null;
                splashFinished = true;
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            }
        }, 2000);
    }

    private View createSplashView() {
        FrameLayout splash = new FrameLayout(this);
        splash.setBackgroundColor(Color.rgb(243, 240, 255));
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams contentParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        content.setPadding(24, 24, 24, 24);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.edusphere_logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setPadding(dp(22), dp(22), dp(22), dp(22));
        GradientDrawable logoBg = new GradientDrawable();
        logoBg.setColor(Color.rgb(91, 75, 255));
        logoBg.setCornerRadius(dp(24));
        logo.setBackground(logoBg);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(104), dp(104));
        logoParams.bottomMargin = dp(20);
        content.addView(logo, logoParams);

        TextView name = new TextView(this);
        name.setText("EduSphere");
        name.setTextColor(Color.rgb(24, 31, 74));
        name.setTextSize(30);
        name.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        name.setGravity(Gravity.CENTER);
        content.addView(name);

        TextView tagline = new TextView(this);
        tagline.setText("Learn. Grow. Achieve.");
        tagline.setTextColor(Color.rgb(79, 75, 130));
        tagline.setTextSize(15);
        tagline.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams taglineParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        taglineParams.topMargin = dp(8);
        content.addView(tagline, taglineParams);

        splash.addView(content, contentParams);
        return splash;
    }

    private int dp(int value) {
        return (int)(value * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == MEDIA_PERMISSION_REQUEST && pendingWebPermission != null) {
            boolean ok = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            if (ok) pendingWebPermission.grant(pendingWebPermission.getResources());
            else pendingWebPermission.deny();
            pendingWebPermission = null;
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override public void onBackPressed() {
        new AlertDialog.Builder(this)
            .setTitle("Exit EduSphere?")
            .setMessage("Do you want to exit EduSphere?")
            .setNegativeButton("Cancel", (dialog, which) -> dialog.dismiss())
            .setPositiveButton("Exit", (dialog, which) -> finish())
            .setCancelable(true)
            .show();
    }
}
