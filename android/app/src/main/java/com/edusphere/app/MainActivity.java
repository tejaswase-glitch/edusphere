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
import android.webkit.JavascriptInterface;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
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
    private static final int RECORDING_SAVE_REQUEST = 43;
    private WebView webView;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private int oldSystemUi;
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> fileCallback;
    private FrameLayout rootLayout;
    private View splashView;
    private boolean splashFinished = false;
    private ByteArrayOutputStream recordingBuffer;
    private String pendingRecordingMime = "video/webm";

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
        webView.addJavascriptInterface(new EduSphereBridge(), "EduSphereNative");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && (host.equals("tejaswase-glitch.github.io") || host.endsWith(".jitsi.net") || host.equals("meet.jit.si") || host.equals("8x8.vc"))) return false;
                if (host != null && (host.equals("youtube.com") || host.endsWith(".youtube.com") || host.equals("youtu.be") || host.equals("youtube-nocookie.com") || host.endsWith(".youtube-nocookie.com"))) return true;
                if ("https".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (Exception ignored) { }
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                runOnUiThread(() -> {
                    if (fullscreenView != null) { callback.onCustomViewHidden(); return; }
                    fullscreenView = view;
                    fullscreenCallback = callback;
                    oldSystemUi = getWindow().getDecorView().getSystemUiVisibility();
                    webView.setVisibility(View.GONE);
                    rootLayout.addView(view, new FrameLayout.LayoutParams(-1, -1));
                    getWindow().getDecorView().setSystemUiVisibility(5894 | 1024 | 512 | 4096);
                });
            }
            @Override public void onHideCustomView() { runOnUiThread(() -> exitFullscreen()); }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    ArrayList<String> needed = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                            && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            needed.add(Manifest.permission.CAMERA);
                        } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                            && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            needed.add(Manifest.permission.RECORD_AUDIO);
                        }
                    }
                    if (needed.isEmpty()) {
                        request.grant(request.getResources());
                    } else {
                        pendingWebPermission = request;
                        ActivityCompat.requestPermissions(MainActivity.this,
                            needed.toArray(new String[0]), MEDIA_PERMISSION_REQUEST);
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
            boolean ok = true;
            for (String resource : pendingWebPermission.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) ok = false;
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) ok = false;
            }
            if (ok) pendingWebPermission.grant(pendingWebPermission.getResources());
            else pendingWebPermission.deny();
            pendingWebPermission = null;
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == RECORDING_SAVE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && recordingBuffer != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out == null) throw new Exception("Could not open destination");
                    recordingBuffer.writeTo(out);
                    Toast.makeText(this, "Lecture video saved successfully", Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Could not save lecture video", Toast.LENGTH_LONG).show();
                }
            } else Toast.makeText(this, "Video save cancelled", Toast.LENGTH_SHORT).show();
            recordingBuffer = null;
        }
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

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        rootLayout.removeView(fullscreenView);
        fullscreenView = null;
        webView.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(oldSystemUi);
        if (fullscreenCallback != null) { fullscreenCallback.onCustomViewHidden(); fullscreenCallback = null; }
    }

    @Override public void onBackPressed() {
        if (fullscreenView != null) { exitFullscreen(); return; }
        String url = webView == null ? "" : webView.getUrl();
        if (url != null && url.contains("classroom.html")) {
            webView.loadUrl("https://tejaswase-glitch.github.io/edusphere/");
            return;
        }
        webView.evaluateJavascript("(function(){"
            + "var d=document.querySelector('dialog[open]');if(d){d.close();return 'closed-dialog';}"
            + "var app=document.getElementById('app');"
            + "if(app&&!app.hidden&&getComputedStyle(app).display!=='none'){"
            + "var view=document.getElementById('view');"
            + "if(view&&view.scrollTop>0){view.scrollTop=0;return 'top';}"
            + "var side=document.getElementById('sideBrand');"
            + "var current=document.querySelector('#sideNav [aria-current=page]');"
            + "if(current&&current.dataset.nav!=='dashboard'&&side){side.click();return 'dashboard';}"
            + "}"
            + "if(window.scrollY>0){window.scrollTo({top:0,behavior:'smooth'});return 'top';}"
            + "return 'exit';})()", value -> {
                if ("\"dashboard\"".equals(value) || "\"top\"".equals(value) || "\"closed-dialog\"".equals(value)) return;
                showExitDialog();
            });
    }

    private GradientDrawable roundedBackground(int color, int radiusDp) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(dp(radiusDp));
        return bg;
    }

    private void showExitDialog() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        panel.setPadding(dp(24), dp(26), dp(24), dp(20));
        GradientDrawable panelBg = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.rgb(246, 247, 255), Color.rgb(255, 255, 255)});
        panelBg.setCornerRadius(dp(26));
        panel.setBackground(panelBg);

        TextView icon = new TextView(this);
        icon.setText("↗");
        icon.setTextColor(Color.WHITE);
        icon.setTextSize(30);
        icon.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        icon.setGravity(Gravity.CENTER);
        GradientDrawable iconBg = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[]{Color.rgb(91, 75, 255), Color.rgb(48, 111, 232)});
        iconBg.setCornerRadius(dp(22));
        icon.setBackground(iconBg);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(66), dp(66));
        iconParams.bottomMargin = dp(18);
        panel.addView(icon, iconParams);

        TextView title = new TextView(this);
        title.setText("Leaving EduSphere?");
        title.setTextColor(Color.rgb(25, 32, 75));
        title.setTextSize(22);
        title.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        title.setGravity(Gravity.CENTER);
        panel.addView(title, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView message = new TextView(this);
        message.setText("Are you sure you want to exit? Your learning space will be right here when you return.");
        message.setTextColor(Color.rgb(100, 105, 132));
        message.setTextSize(14);
        message.setGravity(Gravity.CENTER);
        message.setLineSpacing(dp(3), 1.0f);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        messageParams.topMargin = dp(10);
        messageParams.bottomMargin = dp(24);
        panel.addView(message, messageParams);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        actions.setWeightSum(2);

        TextView cancel = new TextView(this);
        cancel.setText("Stay here");
        cancel.setTextColor(Color.rgb(65, 76, 145));
        cancel.setTextSize(15);
        cancel.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        cancel.setGravity(Gravity.CENTER);
        cancel.setBackground(roundedBackground(Color.rgb(232, 235, 250), 15));
        cancel.setPadding(dp(8), 0, dp(8), 0);
        LinearLayout.LayoutParams cancelParams = new LinearLayout.LayoutParams(0, dp(50), 1);
        cancelParams.rightMargin = dp(8);
        actions.addView(cancel, cancelParams);

        TextView exit = new TextView(this);
        exit.setText("Exit app");
        exit.setTextColor(Color.WHITE);
        exit.setTextSize(15);
        exit.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        exit.setGravity(Gravity.CENTER);
        GradientDrawable exitBg = new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            new int[]{Color.rgb(238, 76, 105), Color.rgb(211, 57, 91)});
        exitBg.setCornerRadius(dp(15));
        exit.setBackground(exitBg);
        exit.setPadding(dp(8), 0, dp(8), 0);
        LinearLayout.LayoutParams exitParams = new LinearLayout.LayoutParams(0, dp(50), 1);
        exitParams.leftMargin = dp(8);
        actions.addView(exit, exitParams);

        panel.addView(actions, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        AlertDialog dialog = new AlertDialog.Builder(this).setView(panel).setCancelable(true).create();
        cancel.setOnClickListener(v -> dialog.dismiss());
        exit.setOnClickListener(v -> {
            dialog.dismiss();
            finish();
        });
        dialog.setOnShowListener(v -> {
            if (dialog.getWindow() != null) {
                dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
                dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
                WindowManager.LayoutParams lp = dialog.getWindow().getAttributes();
                lp.dimAmount = 0.62f;
                lp.width = getResources().getDisplayMetrics().widthPixels - dp(48);
                dialog.getWindow().setAttributes(lp);
            }
        });
        dialog.show();
    }

    private class EduSphereBridge {
        @JavascriptInterface public void beginRecordingSave(String mimeType) {
            recordingBuffer = new ByteArrayOutputStream();
            pendingRecordingMime = mimeType == null ? "video/webm" : mimeType;
        }
        @JavascriptInterface public void appendRecordingChunk(String base64) {
            try {
                if (recordingBuffer != null && base64 != null) recordingBuffer.write(Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception ignored) { }
        }
        @JavascriptInterface public void finishRecordingSave(String fileName) {
            runOnUiThread(() -> {
                if (recordingBuffer == null || recordingBuffer.size() == 0) {
                    Toast.makeText(MainActivity.this, "No recording data received", Toast.LENGTH_LONG).show();
                    return;
                }
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(pendingRecordingMime);
                intent.putExtra(Intent.EXTRA_TITLE, fileName == null ? "EduSphere-Lecture.webm" : fileName);
                try { startActivityForResult(intent, RECORDING_SAVE_REQUEST); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Unable to open save location", Toast.LENGTH_LONG).show(); }
            });
        }
        @JavascriptInterface public void cancelRecordingSave() { recordingBuffer = null; }
    }
}
