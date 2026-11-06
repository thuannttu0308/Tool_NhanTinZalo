package vn.tmark.nhantinzalo;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class ZaloAccessibilityService extends AccessibilityService {

    static volatile ZaloAccessibilityService instance;

    private static final String[] NOT_FOUND = {
            "chưa đăng ký", "không tồn tại", "không tìm thấy", "chưa có tài khoản", "not registered"
    };
    private static final String[] OPEN_CHAT = {"Nhắn tin", "Gửi tin nhắn", "Message", "Chat"};

    private static final int STAGE_OPEN = 0;
    private static final int STAGE_SEND = 1;
    private static final int STAGE_VERIFY = 2;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tickRunnable = this::tick;
    private Job job;

    private static class Job {
        String id;
        List<String> messages;
        int delayMs;
        int index;
        int stage = STAGE_OPEN;
        long startedAt;
        long windowChangedAt;
        long lastClickAt;
        boolean chatOpened;
        int openClicks;
        int sendTries;
        int verifyTries;
    }

    @Override
    protected void onServiceConnected() {
        instance = this;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        instance = null;
        if (job != null) finish(false, "Quyền Trợ năng đã bị tắt");
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        Job j = job;
        if (j == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        if (event.getPackageName() != null && MainActivity.ZALO_PACKAGE.contentEquals(event.getPackageName())) {
            j.windowChangedAt = SystemClock.uptimeMillis();
        }
    }

    void startJob(String id, String phone, List<String> messages, int delayMs) {
        handler.post(() -> {
            if (job != null) finish(false, "Bị huỷ do có lượt gửi mới");
            Job j = new Job();
            j.id = id;
            j.messages = messages;
            j.delayMs = Math.max(0, delayMs);
            j.startedAt = SystemClock.uptimeMillis();
            job = j;
            later(1200);
        });
    }

    void cancelJob() {
        handler.post(() -> {
            job = null;
            handler.removeCallbacks(tickRunnable);
        });
    }

    private void later(long ms) {
        handler.removeCallbacks(tickRunnable);
        handler.postDelayed(tickRunnable, ms);
    }

    private void tick() {
        Job j = job;
        if (j == null) return;
        long now = SystemClock.uptimeMillis();
        long timeout = 30000L + (long) j.messages.size() * (j.delayMs + 8000L);
        if (now - j.startedAt > timeout) {
            finish(false, j.chatOpened ? "Hết thời gian chờ gửi tin" : "Không mở được cuộc trò chuyện");
            return;
        }

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null
                || !MainActivity.ZALO_PACKAGE.contentEquals(root.getPackageName())) {
            later(500);
            return;
        }

        switch (j.stage) {
            case STAGE_OPEN:
                stepOpen(j, root, now);
                break;
            case STAGE_SEND:
                stepSend(j, root);
                break;
            case STAGE_VERIFY:
                stepVerify(j, root);
                break;
        }
    }

    // Chờ Zalo mở đúng cuộc trò chuyện rồi điền nội dung
    private void stepOpen(Job j, AccessibilityNodeInfo root, long now) {
        if (!j.chatOpened) {
            if (j.windowChangedAt == 0 || now - j.windowChangedAt < 1000) {
                later(400);
                return;
            }
        }
        AccessibilityNodeInfo input = findInput(root);
        if (input == null) {
            if (containsAny(root, NOT_FOUND)) {
                finish(false, "Số chưa đăng ký Zalo hoặc không tìm thấy");
                return;
            }
            AccessibilityNodeInfo btn = findClickableByText(root, OPEN_CHAT);
            if (btn != null && j.openClicks < 3 && now - j.lastClickAt > 2000) {
                click(btn);
                j.openClicks++;
                j.lastClickAt = now;
            }
            later(600);
            return;
        }
        j.chatOpened = true;
        input.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, j.messages.get(j.index));
        if (!input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            finish(false, "Không điền được nội dung vào Zalo");
            return;
        }
        j.stage = STAGE_SEND;
        j.sendTries = 0;
        later(700);
    }

    private void stepSend(Job j, AccessibilityNodeInfo root) {
        AccessibilityNodeInfo input = findInput(root);
        AccessibilityNodeInfo send = findSendButton(root, input);
        if (send == null) {
            if (++j.sendTries > 8) finish(false, "Không tìm thấy nút Gửi");
            else later(500);
            return;
        }
        click(send);
        j.stage = STAGE_VERIFY;
        j.verifyTries = 0;
        later(1200);
    }

    private void stepVerify(Job j, AccessibilityNodeInfo root) {
        AccessibilityNodeInfo input = findInput(root);
        if (input != null && !isEmpty(input)) {
            if (++j.verifyTries > 2) {
                finish(false, "Tin nhắn chưa được gửi đi");
                return;
            }
            j.stage = STAGE_SEND;
            later(400);
            return;
        }
        j.index++;
        if (j.index >= j.messages.size()) {
            finish(true, null);
            return;
        }
        j.stage = STAGE_OPEN;
        later(Math.max(500, j.delayMs));
    }

    private void finish(boolean ok, String error) {
        Job j = job;
        job = null;
        handler.removeCallbacks(tickRunnable);
        if (j == null) return;

        Intent back = new Intent(this, MainActivity.class);
        back.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            startActivity(back);
        } catch (Exception ignored) {
        }
        handler.postDelayed(() -> {
            MainActivity a = MainActivity.current.get();
            if (a != null) a.deliverResult(j.id, ok, error);
        }, 600);
    }

    // Ô nhập tin nhắn là ô có thể nhập nằm thấp nhất màn hình
    private AccessibilityNodeInfo findInput(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all);
        AccessibilityNodeInfo best = null;
        int bestTop = -1;
        Rect r = new Rect();
        for (AccessibilityNodeInfo n : all) {
            if (!n.isEditable() || !n.isVisibleToUser()) continue;
            n.getBoundsInScreen(r);
            if (r.top > bestTop) {
                bestTop = r.top;
                best = n;
            }
        }
        return best;
    }

    private AccessibilityNodeInfo findSendButton(AccessibilityNodeInfo root, AccessibilityNodeInfo input) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all);

        for (AccessibilityNodeInfo n : all) {
            String id = n.getViewIdResourceName();
            if (id != null && id.toLowerCase(Locale.ROOT).contains("send") && n.isVisibleToUser()) {
                AccessibilityNodeInfo c = clickable(n);
                if (c != null) return c;
            }
        }
        for (AccessibilityNodeInfo n : all) {
            String d = lower(n.getContentDescription());
            if ((d.equals("gửi") || d.contains("gửi tin") || d.equals("send")) && n.isVisibleToUser()) {
                AccessibilityNodeInfo c = clickable(n);
                if (c != null) return c;
            }
        }
        if (input == null) return null;

        Rect in = new Rect();
        input.getBoundsInScreen(in);
        AccessibilityNodeInfo best = null;
        int bestLeft = -1;
        Rect r = new Rect();
        for (AccessibilityNodeInfo n : all) {
            if (!n.isClickable() || !n.isVisibleToUser() || n.isEditable()) continue;
            n.getBoundsInScreen(r);
            boolean sameRow = r.centerY() >= in.top - in.height() && r.centerY() <= in.bottom + in.height();
            if (sameRow && r.left >= in.right - 10 && r.left > bestLeft) {
                bestLeft = r.left;
                best = n;
            }
        }
        return best;
    }

    private AccessibilityNodeInfo findClickableByText(AccessibilityNodeInfo root, String[] texts) {
        for (String t : texts) {
            List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByText(t);
            if (found == null) continue;
            for (AccessibilityNodeInfo n : found) {
                String label = lower(n.getText());
                if (label.isEmpty()) label = lower(n.getContentDescription());
                if (!label.equals(t.toLowerCase(Locale.ROOT)) || !n.isVisibleToUser()) continue;
                AccessibilityNodeInfo c = clickable(n);
                if (c != null) return c;
            }
        }
        return null;
    }

    private boolean containsAny(AccessibilityNodeInfo root, String[] texts) {
        for (String t : texts) {
            List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByText(t);
            if (found != null) {
                for (AccessibilityNodeInfo n : found) if (n.isVisibleToUser()) return true;
            }
        }
        return false;
    }

    private boolean isEmpty(AccessibilityNodeInfo input) {
        if (Build.VERSION.SDK_INT >= 26 && input.isShowingHintText()) return true;
        CharSequence t = input.getText();
        if (t == null || t.toString().trim().isEmpty()) return true;
        if (Build.VERSION.SDK_INT >= 26 && input.getHintText() != null) {
            return t.toString().equals(input.getHintText().toString());
        }
        return false;
    }

    private AccessibilityNodeInfo clickable(AccessibilityNodeInfo n) {
        int depth = 0;
        while (n != null && depth++ < 5) {
            if (n.isClickable() && n.isEnabled()) return n;
            n = n.getParent();
        }
        return null;
    }

    private void click(AccessibilityNodeInfo n) {
        n.performAction(AccessibilityNodeInfo.ACTION_CLICK);
    }

    private void collect(AccessibilityNodeInfo n, List<AccessibilityNodeInfo> out) {
        if (n == null) return;
        out.add(n);
        for (int i = 0; i < n.getChildCount(); i++) collect(n.getChild(i), out);
    }

    private static String lower(CharSequence s) {
        return s == null ? "" : s.toString().trim().toLowerCase(Locale.ROOT);
    }
}
