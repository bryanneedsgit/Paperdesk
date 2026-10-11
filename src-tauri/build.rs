fn main() {
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    println!("cargo:rerun-if-changed=native");
    if target == "macos" {
        cc::Build::new()
            .cpp(true)
            .file("native/print_mac.mm")
            .flag("-std=c++17")
            .flag("-fobjc-arc")
            .compile("paperdesk_print");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=PDFKit");
    } else if target == "windows" {
        cc::Build::new()
            .cpp(true)
            .file("native/print_windows.cpp")
            .define("_WIN32_WINNT", "0x0A00")
            .define("WINVER", "0x0A00")
            .flag("/std:c++17")
            .flag("/EHsc")
            .flag("/utf-8")
            .compile("paperdesk_print");
        for lib in [
            "comdlg32",
            "comctl32",
            "gdi32",
            "ole32",
            "windowsapp",
            "windowscodecs",
        ] {
            println!("cargo:rustc-link-lib={lib}");
        }
    }
    tauri_build::build()
}
