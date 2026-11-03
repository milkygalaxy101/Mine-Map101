package id.urcifield.app;

// UrciStorage: moves bytes between the WebView, app-private storage and the user's data folder (SAF).
// All decisions (sync, merge, recovery, naming) live in JS (store.js). Proven on device by the week-1 spike.
//
// Typed reject codes: BAD_ARGS, NO_FOLDER, PERMISSION_LOST, NOT_FOUND, NAME_CLASH, NO_SPACE, NO_PICKER,
// PICKER_ERROR, CANCELLED, BAD_IMAGE, OOM, GPS_OFF, NO_FIX, PERMISSION, IO.
//
// Paths are "a/b/c" relative to the chosen folder; "", ".", ".." and absolute paths are refused.

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(name = "UrciStorage")
public class UrciStoragePlugin extends Plugin {

    private static final String PREFS = "urci_storage";
    private static final String KEY_TREE = "tree_uri";
    private static final String SAF_PREFIX = "/_saf/";
    private static final String DRAFT_DIR = "draft-photos";
    private static final long MAX_TEXT = 4L * 1024 * 1024;

    // ---------- /_saf/<path>: data-folder files served to the WebView (photos), no base64 bridge ----------
    @Override
    public void load() {
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String path = request.getUrl().getPath();
                if (path != null && path.startsWith(SAF_PREFIX)) return serveSaf(path.substring(SAF_PREFIX.length()));
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    private WebResourceResponse serveSaf(String rel) {
        try {
            DocumentFile f = resolve(rel, false);
            if (f == null || !f.isFile()) return notFound();
            InputStream in = getContext().getContentResolver().openInputStream(f.getUri());
            String ext = MimeTypeMap.getFileExtensionFromUrl(f.getName());
            String mime = ext != null ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase()) : null;
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime != null ? mime : "application/octet-stream", null, 200, "OK", headers, in);
        } catch (Exception e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), null);
    }

    // ---------- folder ----------
    @PluginMethod
    public void pickFolder(PluginCall call) {
        final Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("No folder picker on this phone (Files app disabled?)", "NO_PICKER");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "onFolderPicked");
            } catch (Exception e) {
                call.reject("Picker failed: " + e, "PICKER_ERROR");
            }
        });
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled", "CANCELLED");
            return;
        }
        Uri tree = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("could not keep folder permission", "PERMISSION_LOST");
            return;
        }
        prefs().edit().putString(KEY_TREE, tree.toString()).apply();
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        ret.put("name", DocumentFile.fromTreeUri(getContext(), tree).getName());
        call.resolve(ret);
    }

    @PluginMethod
    public void folderStatus(PluginCall call) {
        DocumentFile root = root();
        JSObject ret = new JSObject();
        ret.put("hasFolder", root != null && root.exists() && root.canWrite());
        ret.put("name", root != null ? root.getName() : null);
        call.resolve(ret);
    }

    // ---------- read / list ----------
    @PluginMethod
    public void list(PluginCall call) {
        String path = call.getString("path", "");
        if (root() == null) { call.reject("no folder", "NO_FOLDER"); return; }
        DocumentFile dir = path.isEmpty() ? root() : resolve(path, false);
        if (dir == null || !dir.isDirectory()) { call.reject("not found: " + path, "NOT_FOUND"); return; }
        JSArray entries = new JSArray();
        for (DocumentFile f : dir.listFiles()) {
            JSObject e = new JSObject();
            e.put("name", f.getName());
            e.put("dir", f.isDirectory());
            if (!f.isDirectory()) e.put("size", f.length());
            entries.put(e);
        }
        JSObject ret = new JSObject();
        ret.put("entries", entries);
        call.resolve(ret);
    }

    @PluginMethod
    public void readText(PluginCall call) {
        String path = call.getString("path");
        if (path == null) { call.reject("path required", "BAD_ARGS"); return; }
        DocumentFile f = resolve(path, false);
        if (f == null || !f.isFile()) { call.reject("not found: " + path, "NOT_FOUND"); return; }
        if (f.length() > MAX_TEXT) { call.reject("file too large", "IO"); return; }
        try (InputStream in = getContext().getContentResolver().openInputStream(f.getUri())) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            JSObject ret = new JSObject();
            ret.put("text", new String(bo.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    // ---------- write ----------
    // Crash-safe replace on SAF (ERR-1): write name.new -> rename name to name.old -> rename .new -> delete .old.
    // JS (store.decideRecovery) repairs leftovers on the next start.
    @PluginMethod
    public void writeTextSafe(PluginCall call) {
        String path = call.getString("path");
        String text = call.getString("text");
        if (path == null || text == null) { call.reject("path and text required", "BAD_ARGS"); return; }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (!hasSpace(bytes.length * 2L)) { call.reject("not enough space", "NO_SPACE"); return; }
        try {
            String[] dn = splitPath(path);
            DocumentFile dir = dn[0].isEmpty() ? root() : resolve(dn[0], true);
            if (dir == null) { call.reject("no folder", root() == null ? "NO_FOLDER" : "PERMISSION_LOST"); return; }
            String name = dn[1];
            DocumentFile stale = dir.findFile(name + ".new");
            if (stale != null) stale.delete();
            DocumentFile tmp = dir.createFile("application/octet-stream", name + ".new");
            if (tmp == null) { call.reject("create failed", "IO"); return; }
            try (OutputStream out = getContext().getContentResolver().openOutputStream(tmp.getUri(), "wt")) {
                if (out == null) throw new Exception("no output stream");
                out.write(bytes);
            }
            DocumentFile existing = dir.findFile(name);
            boolean renamedOld = false;
            if (existing != null) {
                DocumentFile oldStale = dir.findFile(name + ".old");
                if (oldStale != null) oldStale.delete();
                renamedOld = existing.renameTo(name + ".old");
                if (!renamedOld) throw new Exception("could not move old file aside");
            }
            if (!tmp.renameTo(name) || !name.equals(tmp.getName())) throw new Exception("could not rename new file (got " + tmp.getName() + ")");
            if (renamedOld) {
                DocumentFile old = dir.findFile(name + ".old");
                if (old != null) old.delete();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String path = call.getString("path");
        if (path == null) { call.reject("path required", "BAD_ARGS"); return; }
        DocumentFile f = resolve(path, false);
        if (f != null && !f.delete()) { call.reject("delete failed", "IO"); return; }
        call.resolve();
    }

    @PluginMethod
    public void rename(PluginCall call) {
        String path = call.getString("path");
        String newName = call.getString("newName");
        if (path == null || newName == null || newName.contains("/") || !safeSegment(newName)) { call.reject("bad args", "BAD_ARGS"); return; }
        DocumentFile f = resolve(path, false);
        if (f == null) { call.reject("not found: " + path, "NOT_FOUND"); return; }
        DocumentFile parent = f.getParentFile();
        if (parent != null && parent.findFile(newName) != null) { call.reject("exists: " + newName, "NAME_CLASH"); return; }
        if (!f.renameTo(newName) || !newName.equals(f.getName())) { call.reject("rename failed", "IO"); return; }
        call.resolve();
    }

    // ---------- photos ----------
    // Draft photos live in app-private files/draft-photos until Save (eng R6).
    @PluginMethod
    public void writeDraftPhoto(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null) { call.reject("base64 required", "BAD_ARGS"); return; }
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            File dir = new File(getContext().getFilesDir(), DRAFT_DIR);
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create draft dir");
            if (dir.getUsableSpace() < bytes.length * 2L) { call.reject("not enough space", "NO_SPACE"); return; }
            File f = new File(dir, UUID.randomUUID() + ".jpg");
            try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(bytes); }
            JSObject ret = new JSObject();
            ret.put("path", f.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    @PluginMethod
    public void deleteDraftPhoto(PluginCall call) {
        File f = draftFile(call.getString("path"));
        if (f == null) { call.reject("not a draft photo", "BAD_ARGS"); return; }
        if (f.exists() && !f.delete()) { call.reject("delete failed", "IO"); return; }
        call.resolve();
    }

    // Copy a draft photo into the data folder with create-new semantics (never overwrite; SAF would auto-rename).
    @PluginMethod
    public void copyDraftIn(PluginCall call) {
        File src = draftFile(call.getString("from"));
        String dest = call.getString("to");
        if (src == null || dest == null) { call.reject("bad args", "BAD_ARGS"); return; }
        if (!src.exists()) { call.reject("draft missing", "NOT_FOUND"); return; }
        if (!hasSpace(src.length() * 2L)) { call.reject("not enough space", "NO_SPACE"); return; }
        try {
            String[] dn = splitPath(dest);
            DocumentFile dir = resolve(dn[0], true);
            if (dir == null) { call.reject("no folder", root() == null ? "NO_FOLDER" : "PERMISSION_LOST"); return; }
            if (dir.findFile(dn[1]) != null) { call.reject("exists: " + dn[1], "NAME_CLASH"); return; }
            DocumentFile out = dir.createFile("image/jpeg", dn[1]);
            if (out == null) throw new Exception("create failed");
            if (!dn[1].equals(out.getName())) { out.delete(); call.reject("name changed by provider", "NAME_CLASH"); return; }
            try (InputStream in = new FileInputStream(src); OutputStream os = getContext().getContentResolver().openOutputStream(out.getUri(), "wt")) {
                if (os == null) throw new Exception("no output stream");
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    // Downscale at capture (eng R7): the camera ignores targetWidth for the file at uri (spike run 1).
    // Bounds pass, power-of-two inSampleSize keeping the long edge >= 3/4 maxEdge, exact scale, EXIF rotation.
    @PluginMethod
    public void downscale(PluginCall call) {
        String src = call.getString("uri");
        int maxEdge = call.getInt("maxEdge", 2048);
        int quality = call.getInt("quality", 92);
        if (src == null) { call.reject("uri required", "BAD_ARGS"); return; }
        Uri uri = src.startsWith("/") ? Uri.fromFile(new File(src)) : Uri.parse(src);
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(in, null, bounds); }
            int sw = bounds.outWidth, sh = bounds.outHeight;
            if (sw <= 0 || sh <= 0) { call.reject("not an image", "BAD_IMAGE"); return; }
            int sample = 1;
            while (Math.max(sw, sh) / (sample * 2) >= maxEdge * 3 / 4) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            Bitmap bmp;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) { bmp = BitmapFactory.decodeStream(in, null, opts); }
            if (bmp == null) { call.reject("decode failed", "BAD_IMAGE"); return; }
            int rotation = 0;
            String dto = null, dtoOffset = null;
            float[] latLong = null;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                ExifInterface exif = new ExifInterface(in);
                int o = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                rotation = o == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : o == ExifInterface.ORIENTATION_ROTATE_180 ? 180 : o == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
                // gallery import: capture time (DateTimeOriginal only, never the file's edit time) and EXIF GPS if present
                dto = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
                dtoOffset = exif.getAttribute("OffsetTimeOriginal");
                float[] ll = new float[2];
                if (exif.getLatLong(ll)) latLong = ll;
            } catch (Exception ignored) { }
            float scale = Math.min(1f, (float) maxEdge / Math.max(bmp.getWidth(), bmp.getHeight()));
            Matrix m = new Matrix();
            m.postScale(scale, scale);
            if (rotation != 0) m.postRotate(rotation);
            Bitmap out = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
            if (out != bmp) bmp.recycle();
            File dir = new File(getContext().getCacheDir(), "pending");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create cache dir");
            File dst = new File(dir, "ds-" + UUID.randomUUID() + ".jpg");
            try (FileOutputStream fo = new FileOutputStream(dst)) { out.compress(Bitmap.CompressFormat.JPEG, quality, fo); }
            JSObject ret = new JSObject();
            ret.put("path", dst.getAbsolutePath());
            ret.put("width", out.getWidth());
            ret.put("height", out.getHeight());
            if (dto != null) ret.put("exifDateTimeOriginal", dto);
            if (dtoOffset != null) ret.put("exifOffsetTimeOriginal", dtoOffset);
            if (latLong != null) { ret.put("exifLat", (double) latLong[0]); ret.put("exifLon", (double) latLong[1]); }
            out.recycle();
            call.resolve(ret);
        } catch (OutOfMemoryError e) {
            call.reject("out of memory", "OOM");
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    // Exports (PDF, later xlsx/zip): write to app cache (shareable via FileProvider) and copy into
    // <data folder>/exports/ with create-new semantics; a clash gets "-2", "-3", ... before the extension.
    @PluginMethod
    public void saveExport(PluginCall call) {
        String name = call.getString("name");
        String b64 = call.getString("base64");
        String mime = call.getString("mime", "application/pdf");
        if (name == null || b64 == null || !safeSegment(name) || name.contains("/")) { call.reject("bad args", "BAD_ARGS"); return; }
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            if (!hasSpace(bytes.length * 3L)) { call.reject("not enough space", "NO_SPACE"); return; }
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create cache dir");
            File cache = new File(dir, name);
            try (FileOutputStream fo = new FileOutputStream(cache)) { fo.write(bytes); }
            DocumentFile exports = resolve("exports", true);
            if (exports == null) { call.reject("no folder", root() == null ? "NO_FOLDER" : "PERMISSION_LOST"); return; }
            int dot = name.lastIndexOf('.');
            String base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
            String finalName = name;
            for (int i = 2; exports.findFile(finalName) != null; i++) finalName = base + "-" + i + ext;
            DocumentFile out = exports.createFile(mime, finalName);
            if (out == null) throw new Exception("create failed");
            try (OutputStream os = getContext().getContentResolver().openOutputStream(out.getUri(), "wt")) {
                if (os == null) throw new Exception("no output stream");
                os.write(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("cachePath", cache.getAbsolutePath());
            ret.put("relPath", "exports/" + out.getName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    // ---------- bundles (.urci.zip) ----------
    // JS (bundle.js) decides what goes in and what is accepted; this code streams bytes and re-enforces the
    // hard limits on the real zip: no absolute or ".." paths, <= 20 MB per entry, <= 2 GB total, <= 20,000 entries.
    private static final long ENTRY_MAX = 20L * 1024 * 1024;
    private static final long TOTAL_MAX = 2L * 1024 * 1024 * 1024;
    private static final int ENTRIES_MAX = 20000;

    @PluginMethod
    public void exportZip(PluginCall call) {
        String name = call.getString("name");
        String manifest = call.getString("manifest");
        JSArray paths = call.getArray("paths");
        if (name == null || manifest == null || paths == null || !safeSegment(name) || name.contains("/")) { call.reject("bad args", "BAD_ARGS"); return; }
        if (root() == null) { call.reject("no folder", "NO_FOLDER"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create cache dir");
            File cache = new File(dir, name);
            long bytes = 0;
            try (ZipOutputStream zo = new ZipOutputStream(new FileOutputStream(cache))) {
                zo.putNextEntry(new ZipEntry("manifest.json"));
                zo.write(manifest.getBytes(StandardCharsets.UTF_8));
                zo.closeEntry();
                byte[] buf = new byte[65536];
                for (int i = 0; i < paths.length(); i++) {
                    String rel = paths.getString(i);
                    DocumentFile f = resolve(rel, false);
                    if (f == null || !f.isFile()) continue; // a photo listed but missing is simply not packed
                    zo.putNextEntry(new ZipEntry(rel));
                    try (InputStream in = getContext().getContentResolver().openInputStream(f.getUri())) {
                        int n;
                        while ((n = in.read(buf)) > 0) { zo.write(buf, 0, n); bytes += n; }
                    }
                    zo.closeEntry();
                }
            }
            if (!hasSpace(cache.length() * 2L)) { cache.delete(); call.reject("not enough space", "NO_SPACE"); return; }
            DocumentFile exports = resolve("exports", true);
            if (exports == null) { call.reject("no folder", "PERMISSION_LOST"); return; }
            String finalName = name;
            String base = name.endsWith(".urci.zip") ? name.substring(0, name.length() - 9) : name;
            for (int i = 2; exports.findFile(finalName) != null; i++) finalName = base + "-" + i + ".urci.zip";
            DocumentFile out = exports.createFile("application/zip", finalName);
            if (out == null) throw new Exception("create failed");
            try (InputStream in = new FileInputStream(cache); OutputStream os = getContext().getContentResolver().openOutputStream(out.getUri(), "wt")) {
                if (os == null) throw new Exception("no output stream");
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            JSObject ret = new JSObject();
            ret.put("cachePath", cache.getAbsolutePath());
            ret.put("relPath", "exports/" + out.getName());
            ret.put("bytes", cache.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    @PluginMethod
    public void pickBundle(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/zip", "application/octet-stream", "application/x-zip-compressed" });
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "onBundlePicked");
            } catch (Exception e) {
                call.reject("Picker failed: " + e, "PICKER_ERROR");
            }
        });
    }

    // Gallery import: the system document picker returns the original file (EXIF time kept), unlike pickers
    // that re-encode a copy. lastModified pre-fills the manual time when the photo has no EXIF time.
    @PluginMethod
    public void pickPhoto(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif" });
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "onPhotoPicked");
            } catch (Exception e) {
                call.reject("Picker failed: " + e, "PICKER_ERROR");
            }
        });
    }

    @ActivityCallback
    private void onPhotoPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.reject("cancelled", "CANCELLED"); return; }
        Uri uri = result.getData().getData();
        DocumentFile f = DocumentFile.fromSingleUri(getContext(), uri);
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", f != null ? f.getName() : null);
        long lm = f != null ? f.lastModified() : 0;
        if (lm > 0) ret.put("lastModified", lm);
        call.resolve(ret);
    }

    @ActivityCallback
    private void onBundlePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.reject("cancelled", "CANCELLED"); return; }
        Uri uri = result.getData().getData();
        DocumentFile f = DocumentFile.fromSingleUri(getContext(), uri);
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", f != null ? f.getName() : null);
        call.resolve(ret);
    }

    // Pass 1: list every entry with its real inflated size and return the small JSON texts for JS to check.
    @PluginMethod
    public void inspectZip(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) { call.reject("uri required", "BAD_ARGS"); return; }
        try (InputStream raw = getContext().getContentResolver().openInputStream(Uri.parse(uriStr)); ZipInputStream zi = new ZipInputStream(raw)) {
            JSArray entries = new JSArray();
            JSObject texts = new JSObject();
            Set<String> seen = new HashSet<>();
            long total = 0;
            int count = 0;
            byte[] buf = new byte[65536];
            ZipEntry ze;
            while ((ze = zi.getNextEntry()) != null) {
                String n = ze.getName();
                if (ze.isDirectory()) continue;
                if (++count > ENTRIES_MAX) { call.reject("too many entries", "BUNDLE_INVALID:TOO_MANY"); return; }
                if (n.startsWith("/") || n.contains("\\") || n.contains("\0") || ("/" + n + "/").contains("/../") || ("/" + n + "/").contains("/./")) { call.reject("unsafe path", "BUNDLE_INVALID:UNSAFE_PATH"); return; }
                if (!seen.add(n)) { call.reject("duplicate entry", "BUNDLE_INVALID:DUPLICATE"); return; }
                boolean keep = n.endsWith(".json");
                ByteArrayOutputStream bo = keep ? new ByteArrayOutputStream() : null;
                long size = 0;
                int r;
                while ((r = zi.read(buf)) > 0) {
                    size += r;
                    if (size > ENTRY_MAX) { call.reject("entry too big", "BUNDLE_INVALID:ENTRY_TOO_BIG"); return; }
                    if (bo != null) bo.write(buf, 0, r);
                }
                total += size;
                if (total > TOTAL_MAX) { call.reject("bundle too big", "BUNDLE_INVALID:TOO_BIG"); return; }
                JSObject e = new JSObject();
                e.put("name", n);
                e.put("size", size);
                entries.put(e);
                if (bo != null) texts.put(n, new String(bo.toByteArray(), StandardCharsets.UTF_8));
            }
            JSObject ret = new JSObject();
            ret.put("entries", entries);
            ret.put("texts", texts);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("not a readable zip: " + e.getMessage(), "BUNDLE_INVALID:NOT_A_BUNDLE");
        }
    }

    // Pass 2: stream only the accepted photo entries into the data folder (create-new; an existing name is
    // skipped as the same file, design SYNC rules). JSON records are applied by JS through the sync rules.
    @PluginMethod
    public void importZipPhotos(PluginCall call) {
        String uriStr = call.getString("uri");
        JSArray accept = call.getArray("accept");
        long need = (long) (call.getDouble("bytes", 0.0) * 1.1);
        if (uriStr == null || accept == null) { call.reject("bad args", "BAD_ARGS"); return; }
        if (!hasSpace(need)) { call.reject("not enough space", "NO_SPACE"); return; }
        Set<String> want = new HashSet<>();
        try { for (int i = 0; i < accept.length(); i++) want.add(accept.getString(i)); } catch (Exception e) { call.reject("bad accept list", "BAD_ARGS"); return; }
        int copied = 0, existed = 0;
        try (InputStream raw = getContext().getContentResolver().openInputStream(Uri.parse(uriStr)); ZipInputStream zi = new ZipInputStream(raw)) {
            byte[] buf = new byte[65536];
            ZipEntry ze;
            while ((ze = zi.getNextEntry()) != null) {
                String n = ze.getName();
                if (!want.contains(n)) continue;
                String[] dn = splitPath(n);
                DocumentFile dir = resolve(dn[0], true);
                if (dir == null) { call.reject("no folder", "PERMISSION_LOST"); return; }
                if (dir.findFile(dn[1]) != null) { existed++; continue; }
                DocumentFile out = dir.createFile("image/jpeg", dn[1]);
                if (out == null || !dn[1].equals(out.getName())) { if (out != null) out.delete(); throw new Exception("could not create " + n); }
                long size = 0;
                try (OutputStream os = getContext().getContentResolver().openOutputStream(out.getUri(), "wt")) {
                    if (os == null) throw new Exception("no output stream");
                    int r;
                    while ((r = zi.read(buf)) > 0) {
                        size += r;
                        if (size > ENTRY_MAX) { os.close(); out.delete(); call.reject("entry too big", "BUNDLE_INVALID:ENTRY_TOO_BIG"); return; }
                        os.write(buf, 0, r);
                    }
                }
                copied++;
            }
            JSObject ret = new JSObject();
            ret.put("copied", copied);
            ret.put("existed", existed);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    // Open or share a file from <data folder>/exports with another app (PDF viewer, WhatsApp, email, Drive).
    @PluginMethod
    public void openExport(PluginCall call) { sendExport(call, false); }

    @PluginMethod
    public void shareExport(PluginCall call) { sendExport(call, true); }

    private void sendExport(PluginCall call, boolean share) {
        String rel = call.getString("relPath");
        if (rel == null || !rel.startsWith("exports/")) { call.reject("bad path", "BAD_ARGS"); return; }
        DocumentFile f = resolve(rel, false);
        if (f == null || !f.isFile()) { call.reject("not found", "NOT_FOUND"); return; }
        String mime = rel.endsWith(".pdf") ? "application/pdf" : "application/zip";
        Intent intent;
        if (share) {
            intent = new Intent(Intent.ACTION_SEND);
            intent.setType(mime);
            intent.putExtra(Intent.EXTRA_STREAM, f.getUri());
        } else {
            intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(f.getUri(), mime);
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(intent, f.getName());
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("no app can open this file", "NO_APP");
        }
    }

    // ---------- device ----------
    @PluginMethod
    public void freeSpace(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("freeBytes", new StatFs(getContext().getFilesDir().getPath()).getAvailableBytes());
        call.resolve(ret);
    }

    // Native GPS fallback for phones without Play Services (eng R8); also gives GPS time for the clock check.
    @PluginMethod
    public void nativeFix(PluginCall call) {
        final LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        final int timeoutMs = call.getInt("timeoutMs", 10000);
        final long t0 = System.currentTimeMillis();
        if (lm == null || !lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) { call.reject("gps off", "GPS_OFF"); return; }
        final Handler h = new Handler(Looper.getMainLooper());
        final boolean[] done = {false};
        final LocationListener[] holder = new LocationListener[1];
        holder[0] = new LocationListener() {
            @Override public void onLocationChanged(Location loc) {
                if (done[0]) return;
                done[0] = true;
                lm.removeUpdates(this);
                JSObject ret = new JSObject();
                ret.put("lat", loc.getLatitude());
                ret.put("lon", loc.getLongitude());
                ret.put("accuracy", loc.getAccuracy());
                ret.put("gpsTime", loc.getTime());
                ret.put("phoneTime", System.currentTimeMillis());
                ret.put("fixMs", System.currentTimeMillis() - t0);
                call.resolve(ret);
            }
            @Override public void onStatusChanged(String p, int s, Bundle b) { }
            @Override public void onProviderEnabled(String p) { }
            @Override public void onProviderDisabled(String p) { }
        };
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, holder[0], Looper.getMainLooper());
        } catch (SecurityException e) {
            call.reject("location permission missing", "PERMISSION");
            return;
        }
        h.postDelayed(() -> {
            if (done[0]) return;
            done[0] = true;
            lm.removeUpdates(holder[0]);
            call.reject("no fix in " + timeoutMs + " ms", "NO_FIX");
        }, timeoutMs);
    }

    // ---------- helpers ----------
    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private DocumentFile root() {
        String s = prefs().getString(KEY_TREE, null);
        if (s == null) return null;
        DocumentFile r = DocumentFile.fromTreeUri(getContext(), Uri.parse(s));
        return r != null && r.exists() ? r : null;
    }

    private static boolean safeSegment(String p) {
        return !p.isEmpty() && !p.equals(".") && !p.equals("..") && !p.contains("\\") && !p.contains("\0");
    }

    private static String[] splitPath(String path) {
        int slash = path.lastIndexOf('/');
        return new String[] { slash >= 0 ? path.substring(0, slash) : "", slash >= 0 ? path.substring(slash + 1) : path };
    }

    private DocumentFile resolve(String rel, boolean createDirs) {
        DocumentFile cur = root();
        if (cur == null || rel == null || rel.startsWith("/")) return null;
        String[] parts = rel.split("/", -1);
        for (int i = 0; i < parts.length; i++) {
            String p = parts[i];
            if (!safeSegment(p)) return null; // no traversal, no empty segments
            DocumentFile next = cur.findFile(p);
            boolean last = i == parts.length - 1;
            if (next == null) {
                if (!createDirs) return null;
                next = cur.createDirectory(p);
                if (next == null) return null;
            }
            if (!last && !next.isDirectory()) return null;
            cur = next;
        }
        return cur;
    }

    private File draftFile(String path) {
        if (path == null) return null;
        try {
            File dir = new File(getContext().getFilesDir(), DRAFT_DIR).getCanonicalFile();
            File f = new File(path).getCanonicalFile();
            return dir.equals(f.getParentFile()) ? f : null;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean hasSpace(long need) {
        try {
            return new StatFs(getContext().getFilesDir().getPath()).getAvailableBytes() > need;
        } catch (Exception e) {
            return true;
        }
    }
}
