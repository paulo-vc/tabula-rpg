#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Abre no navegador do sistema os links externos (ex.: publicar um sistema no GitHub).
        .plugin(tauri_plugin_opener::init())
        // Reinicia o app depois de instalar uma atualização.
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Atualização automática: baixa, confere a assinatura e instala (só no desktop).
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o aplicativo Tauri");
}
