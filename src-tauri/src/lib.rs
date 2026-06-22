use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

// ── Engine state ───────────────────────────────────────────────

struct EngineState {
    url:    Arc<Mutex<Option<String>>>,
    status: Arc<Mutex<String>>,  // "starting" | "ok:PORT" | "error:REASON"
}

static ENGINE_CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);

// ── Tauri commands ─────────────────────────────────────────────

#[tauri::command]
fn get_engine_url(state: State<EngineState>) -> String {
    state.url.lock().unwrap().clone().unwrap_or_else(|| "http://127.0.0.1:49373".to_string())
}

#[tauri::command]
fn get_engine_status(state: State<EngineState>) -> String {
    state.status.lock().unwrap().clone()
}

#[tauri::command]
fn get_home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/".to_string())
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

// ── Termux: launch a bash script in background via RUN_COMMAND intent ──

#[cfg(target_os = "android")]
#[tauri::command]
fn launch_termux_script(script_path: String) -> Result<(), String> {
    use jni::{JavaVM, objects::{JObject, JValue}};

    let ndk_ctx = ndk_context::android_context();

    let vm = unsafe {
        JavaVM::from_raw(ndk_ctx.vm() as *mut jni::sys::JavaVM)
            .map_err(|e| e.to_string())?
    };
    let ctx_ptr = ndk_ctx.context() as jni::sys::jobject;

    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let context = unsafe { JObject::from_raw(ctx_ptr) };

    // new Intent("com.termux.RUN_COMMAND")
    let intent_cls = env.find_class("android/content/Intent").map_err(|e| e.to_string())?;
    let action = env.new_string("com.termux.RUN_COMMAND").map_err(|e| e.to_string())?;
    let intent = env.new_object(&intent_cls, "(Ljava/lang/String;)V",
                                &[JValue::from(&action)])
                   .map_err(|e| e.to_string())?;

    // intent.setClassName("com.termux", "com.termux.app.RunCommandService")
    let pkg = env.new_string("com.termux").map_err(|e| e.to_string())?;
    let svc = env.new_string("com.termux.app.RunCommandService").map_err(|e| e.to_string())?;
    env.call_method(&intent, "setClassName",
                    "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;",
                    &[JValue::from(&pkg), JValue::from(&svc)])
       .map_err(|e| e.to_string())?;

    // putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
    let k = env.new_string("com.termux.RUN_COMMAND_PATH").map_err(|e| e.to_string())?;
    let v = env.new_string("/data/data/com.termux/files/usr/bin/bash").map_err(|e| e.to_string())?;
    env.call_method(&intent, "putExtra",
                    "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;",
                    &[JValue::from(&k), JValue::from(&v)])
       .map_err(|e| e.to_string())?;

    // putExtra("com.termux.RUN_COMMAND_ARGUMENTS", [script_path])
    let k = env.new_string("com.termux.RUN_COMMAND_ARGUMENTS").map_err(|e| e.to_string())?;
    let str_cls = env.find_class("java/lang/String").map_err(|e| e.to_string())?;
    let arr = env.new_object_array(1i32, &str_cls, JObject::null())
                 .map_err(|e| e.to_string())?;
    let s0 = env.new_string(&script_path).map_err(|e| e.to_string())?;
    env.set_object_array_element(&arr, 0, &s0).map_err(|e| e.to_string())?;
    let arr_obj = JObject::from(arr);
    env.call_method(&intent, "putExtra",
                    "(Ljava/lang/String;[Ljava/lang/String;)Landroid/content/Intent;",
                    &[JValue::from(&k), JValue::from(&arr_obj)])
       .map_err(|e| e.to_string())?;

    // putExtra("com.termux.RUN_COMMAND_WORKDIR", "/sdcard")
    let k = env.new_string("com.termux.RUN_COMMAND_WORKDIR").map_err(|e| e.to_string())?;
    let v = env.new_string("/sdcard").map_err(|e| e.to_string())?;
    env.call_method(&intent, "putExtra",
                    "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;",
                    &[JValue::from(&k), JValue::from(&v)])
       .map_err(|e| e.to_string())?;

    // putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
    let k = env.new_string("com.termux.RUN_COMMAND_BACKGROUND").map_err(|e| e.to_string())?;
    env.call_method(&intent, "putExtra",
                    "(Ljava/lang/String;Z)Landroid/content/Intent;",
                    &[JValue::from(&k), JValue::Bool(1u8)])
       .map_err(|e| e.to_string())?;

    // context.startForegroundService(intent)
    env.call_method(&context, "startForegroundService",
                    "(Landroid/content/Intent;)Landroid/content/ComponentName;",
                    &[JValue::from(&intent)])
       .map_err(|e| {
           let s = e.to_string();
           eprintln!("[termux] error: {s}");
           if s.contains("Permission") || s.contains("denied") {
               "PERMISSION_DENIED: Enable 'Allow External Apps' in Termux → Settings".to_string()
           } else if s.contains("unable to start") || s.contains("not found") {
               "NOT_FOUND: Install Termux from F-Droid".to_string()
           } else {
               format!("Termux error: {s}")
           }
       })?;

    eprintln!("[termux] launched: {}", script_path);
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn launch_termux_script(_script_path: String) -> Result<(), String> {
    Err("Termux integration is Android-only".to_string())
}

// ── Android: find native lib dir via dladdr (most reliable) ────
// dladdr returns the path of the .so file containing the given address.
// libsanction_lib.so (our Rust binary) lives in the same jniLibs dir
// as libsanction_engine.so, so we can use it as a probe.

#[cfg(target_os = "android")]
fn native_lib_dir_via_dladdr() -> Option<PathBuf> {
    use std::ffi::{c_char, c_void, CStr};

    #[repr(C)]
    struct DlInfo {
        dli_fname: *const c_char,
        dli_fbase: *const c_void,
        dli_sname: *const c_char,
        dli_saddr: *const c_void,
    }

    extern "C" {
        fn dladdr(addr: *const c_void, info: *mut DlInfo) -> i32;
    }

    let mut info: DlInfo = unsafe { std::mem::zeroed() };
    let probe = native_lib_dir_via_dladdr as *const c_void;
    if unsafe { dladdr(probe, &mut info) } == 0 || info.dli_fname.is_null() {
        eprintln!("[engine] dladdr failed");
        return None;
    }
    let path_str = unsafe { CStr::from_ptr(info.dli_fname).to_string_lossy() };
    eprintln!("[engine] dladdr: our lib is at {}", path_str);
    let lib_path = PathBuf::from(path_str.as_ref());
    let dir = lib_path.parent()?;
    let engine = dir.join("libsanction_engine.so");
    eprintln!("[engine] dladdr: engine candidate {:?} exists={}", engine, engine.exists());
    engine.exists().then(|| dir.to_path_buf())
}

#[cfg(target_os = "android")]
fn native_lib_dir_via_maps() -> Option<PathBuf> {
    let file = std::fs::File::open("/proc/self/maps").ok()?;
    for line in std::io::BufReader::new(file).lines().flatten() {
        let path = match line.split_whitespace().last() {
            Some(p) if p.starts_with('/') => p.to_string(),
            _ => continue,
        };
        let p = PathBuf::from(&path);
        // Extracted .so in lib dir (most common case)
        if path.contains("/lib/") && path.ends_with(".so") {
            if let Some(dir) = p.parent() {
                let engine = dir.join("libsanction_engine.so");
                if engine.exists() {
                    eprintln!("[engine] maps: engine at {:?}", engine);
                    return Some(dir.to_path_buf());
                }
            }
        }
        // APK path → derive lib dir
        if path.ends_with(".apk") {
            if let Some(pkg_dir) = p.parent() {
                for sub in &["lib/arm64-v8a", "lib/arm64"] {
                    let lib_dir = pkg_dir.join(sub);
                    let engine = lib_dir.join("libsanction_engine.so");
                    if engine.exists() {
                        eprintln!("[engine] maps/apk: engine at {:?}", engine);
                        return Some(lib_dir);
                    }
                }
            }
        }
    }
    None
}

#[cfg(target_os = "android")]
fn get_native_lib_dir() -> Option<PathBuf> {
    native_lib_dir_via_dladdr().or_else(native_lib_dir_via_maps)
}

// ── Engine path resolution ─────────────────────────────────────

fn resolve_engine_path(app: &tauri::App) -> PathBuf {
    let bin_name = if cfg!(target_os = "windows") { "sanction-engine.exe" } else { "sanction-engine" };

    #[cfg(target_os = "android")]
    {
        if let Some(lib_dir) = get_native_lib_dir() {
            let p = lib_dir.join("libsanction_engine.so");
            if p.exists() {
                eprintln!("[engine] resolved (jniLibs): {:?}", p);
                return p;
            }
        }
        // Fallback: extracted asset in app data dir
        let candidates: &[&dyn Fn() -> Option<PathBuf>] = &[
            &|| app.path().data_dir().ok(),
            &|| app.path().data_dir().ok().map(|p| p.join("files")),
            &|| app.path().app_data_dir().ok(),
            &|| app.path().app_local_data_dir().ok(),
        ];
        for f in candidates {
            if let Some(dir) = f() {
                let p = dir.join(bin_name);
                if p.exists() {
                    eprintln!("[engine] resolved (data): {:?}", p);
                    return p;
                }
            }
        }
    }

    if cfg!(debug_assertions) {
        let exe = std::env::current_exe().unwrap_or_default();
        let mut dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        for _ in 0..6 {
            let candidate = dir.join("engine").join(bin_name);
            if candidate.exists() { return candidate; }
            if let Some(p) = dir.parent() { dir = p.to_path_buf(); } else { break; }
        }
        PathBuf::from("engine").join(bin_name)
    } else {
        let target = std::env::var("TAURI_ENV_TARGET_TRIPLE").unwrap_or_else(|_| {
            format!("{}-{}-{}", std::env::consts::ARCH, "unknown", std::env::consts::OS)
        });
        let sidecar = format!("{}-{}", bin_name, target);
        if let Ok(res) = app.path().resource_dir() {
            let p = res.join(&sidecar);
            if p.exists() { return p; }
            let p2 = res.join(bin_name);
            if p2.exists() { return p2; }
        }
        let exe_dir = std::env::current_exe()
            .ok().and_then(|e| e.parent().map(|p| p.to_path_buf())).unwrap_or_default();
        let p = exe_dir.join(&sidecar);
        if p.exists() { return p; }
        exe_dir.join(bin_name)
    }
}

// ── Android: extract engine binary from APK assets ────────────
// Only runs if the jniLibs path doesn't exist (shouldn't happen in normal installs).

#[cfg(target_os = "android")]
fn install_engine_android(app: &tauri::App) {
    use std::os::unix::fs::PermissionsExt;
    let bin_name = "sanction-engine";

    if let Some(lib_dir) = get_native_lib_dir() {
        if lib_dir.join("libsanction_engine.so").exists() {
            eprintln!("[engine] jniLibs binary present — skip asset extraction");
            return;
        }
    }

    let Ok(data_dir) = app.path().data_dir() else {
        eprintln!("[engine] can't get data_dir");
        return;
    };
    let dest = data_dir.join(bin_name);
    if !dest.exists() {
        match app.asset_resolver().get(format!("native/{}", bin_name)) {
            Some(asset) => {
                if let Err(e) = std::fs::write(&dest, &*asset.bytes) {
                    eprintln!("[engine] write failed: {e}");
                    return;
                }
                eprintln!("[engine] asset extracted to {:?}", dest);
            }
            None => {
                eprintln!("[engine] asset native/{} not found in APK", bin_name);
                return;
            }
        }
    }
    let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    eprintln!("[engine] installed to {:?}", dest);
}

// ── Start engine process ───────────────────────────────────────

fn start_engine(
    engine_url:    Arc<Mutex<Option<String>>>,
    engine_status: Arc<Mutex<String>>,
    bin_path: PathBuf,
) {
    std::thread::spawn(move || {
        if !bin_path.exists() {
            let msg = format!("error:not found at {:?}", bin_path);
            eprintln!("[engine] {msg}");
            *engine_status.lock().unwrap() = msg;
            return;
        }

        eprintln!("[engine] spawning {:?}", bin_path);
        let mut child = match Command::new(&bin_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("error:spawn failed: {e}");
                eprintln!("[engine] {msg}");
                *engine_status.lock().unwrap() = msg;
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Drain stderr in background for diagnostics
        if let Some(se) = stderr {
            std::thread::spawn(|| {
                for line in std::io::BufReader::new(se).lines().flatten() {
                    eprintln!("[engine-stderr] {line}");
                }
            });
        }

        if let Ok(mut g) = ENGINE_CHILD.lock() { *g = Some(child); }

        // Wait for READY:PORT signal on stdout
        if let Some(so) = stdout {
            for line in std::io::BufReader::new(so).lines().flatten() {
                eprintln!("[engine-stdout] {line}");
                if let Some(port) = line.strip_prefix("READY:") {
                    let url = format!("http://127.0.0.1:{}", port.trim());
                    *engine_url.lock().unwrap()    = Some(url.clone());
                    *engine_status.lock().unwrap() = format!("ok:{}", port.trim());
                    eprintln!("[engine] ready at {url}");
                    break;
                }
            }
        }
    });
}

// ── Entry point ────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine_url:    Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let engine_status: Arc<Mutex<String>>         = Arc::new(Mutex::new("starting".to_string()));
    let url_clone    = engine_url.clone();
    let status_clone = engine_status.clone();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(not(target_os = "android"))]
    let builder = builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init());

    let app = builder
        .manage(EngineState { url: engine_url, status: engine_status })
        .setup(move |app| {
            #[cfg(target_os = "android")]
            install_engine_android(app);
            start_engine(url_clone, status_clone, resolve_engine_path(app));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_url,
            get_engine_status,
            get_home_dir,
            get_platform,
            launch_termux_script,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                if let Ok(mut g) = ENGINE_CHILD.lock() {
                    if let Some(mut child) = g.take() {
                        eprintln!("[engine] shutting down");
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
            _ => {}
        }
    });
}
