#define NOMINMAX
#include <windows.h>
#include <cmath>
#include <climits>
#include <thread>
#include <functional>
#include <commdlg.h>
#include <commctrl.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Data.Pdf.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include "print_selection.h"

using namespace winrt;
using namespace Windows::Data::Pdf;
using namespace Windows::Storage::Streams;
using namespace Windows::Graphics::Imaging;
namespace {
struct Options {
    uint32_t count, current;
    std::vector<uint32_t> selected, pages;
    bool annotations = true;
    HWND window = nullptr;
};
std::string utf8(const std::wstring& value) { return to_string(value); }
void update(Options& o) {
    wchar_t range[4096]{};
    GetDlgItemTextW(o.window, 102, range, 4096);
    try {
        o.pages = paperdesk::select_pages(o.count,
            (int)SendDlgItemMessageW(o.window, 101, CB_GETCURSEL, 0, 0), o.current, o.selected,
            utf8(range), (int)SendDlgItemMessageW(o.window, 103, CB_GETCURSEL, 0, 0),
            IsDlgButtonChecked(o.window, 104) == BST_CHECKED);
        auto summary = std::to_wstring(o.pages.size()) + L" pages — Document page numbers";
        SetDlgItemTextW(o.window, 106, summary.c_str());
    } catch (const std::exception& error) {
        o.pages.clear(); SetDlgItemTextW(o.window, 106, to_hstring(error.what()).c_str());
    } catch (...) {
        o.pages.clear(); SetDlgItemTextW(o.window, 106, L"Enter valid page numbers and ranges.");
    }
    o.annotations = IsDlgButtonChecked(o.window, 105) == BST_CHECKED;
    EnableWindow(GetDlgItem(o.window, 102), SendDlgItemMessageW(o.window, 101, CB_GETCURSEL, 0, 0) == 3);
}
INT_PTR CALLBACK page_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    auto o = reinterpret_cast<Options*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (msg == WM_INITDIALOG) {
        o = reinterpret_cast<Options*>(reinterpret_cast<PROPSHEETPAGEW*>(lp)->lParam);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(o)); o->window = hwnd;
        auto control = [&](const wchar_t* cls, const wchar_t* text, DWORD style, int id, int x, int y, int w, int h) {
            RECT r{x,y,x+w,y+h}; MapDialogRect(hwnd, &r);
            HWND child = CreateWindowExW(0, cls, text, WS_CHILD | WS_VISIBLE | style, r.left, r.top,
                r.right-r.left, r.bottom-r.top, hwnd, reinterpret_cast<HMENU>((INT_PTR)id), GetModuleHandleW(nullptr), nullptr);
            SendMessageW(child, WM_SETFONT, SendMessageW(hwnd, WM_GETFONT, 0, 0), TRUE); return child;
        };
        control(L"STATIC", L"&Pages", 0, 0, 8, 12, 62, 12);
        auto scope = control(L"COMBOBOX", L"", CBS_DROPDOWNLIST | WS_TABSTOP | WS_VSCROLL, 101, 74, 8, 165, 90);
        for (auto label : {L"All pages", L"Current page", L"Selected thumbnails", L"Custom range"}) SendMessageW(scope, CB_ADDSTRING, 0, (LPARAM)label);
        SendMessageW(scope, CB_SETCURSEL, 0, 0);
        control(L"STATIC", L"&Range", 0, 0, 8, 40, 62, 12);
        control(L"EDIT", L"", WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL, 102, 74, 36, 165, 16);
        SendDlgItemMessageW(hwnd, 102, EM_SETLIMITTEXT, 4095, 0);
        SendDlgItemMessageW(hwnd, 102, EM_SETCUEBANNER, TRUE, (LPARAM)L"1-3, 7, 10-12");
        control(L"STATIC", L"P&rint", 0, 0, 8, 68, 62, 12);
        auto parity = control(L"COMBOBOX", L"", CBS_DROPDOWNLIST | WS_TABSTOP, 103, 74, 64, 165, 90);
        for (auto label : {L"All", L"Odd pages only", L"Even pages only"}) SendMessageW(parity, CB_ADDSTRING, 0, (LPARAM)label);
        SendMessageW(parity, CB_SETCURSEL, 0, 0);
        control(L"BUTTON", L"Reverse order", BS_AUTOCHECKBOX | WS_TABSTOP, 104, 74, 92, 165, 16);
        control(L"BUTTON", L"Include annotations", BS_AUTOCHECKBOX | WS_TABSTOP, 105, 74, 114, 165, 16);
        CheckDlgButton(hwnd, 105, BST_CHECKED);
        control(L"STATIC", L"", 0, 106, 8, 144, 235, 40);
        update(*o); return TRUE;
    }
    if (!o) return FALSE;
    if (msg == WM_COMMAND) { update(*o); return TRUE; }
    if (msg == WM_NOTIFY) {
        auto code = reinterpret_cast<NMHDR*>(lp)->code;
        if (code == PSN_APPLY || code == PSN_KILLACTIVE) {
            update(*o);
            SetWindowLongPtrW(hwnd, DWLP_MSGRESULT, o->pages.empty() ?
                (code == PSN_APPLY ? PSNRET_INVALID_NOCHANGEPAGE : TRUE) : FALSE);
            return TRUE;
        }
    }
    return FALSE;
}
PdfDocument load_pdf(const uint8_t* bytes, size_t length) {
    InMemoryRandomAccessStream stream;
    DataWriter writer(stream);
    writer.WriteBytes(array_view<const uint8_t>(bytes, bytes + length));
    writer.StoreAsync().get(); writer.DetachStream(); stream.Seek(0);
    return PdfDocument::LoadFromStreamAsync(stream).get();
}
// Keep PrintDlgEx on the owning UI STA. PDF decoding and spooling run on a
// dedicated MTA while this thread pumps messages, keeping the app responsive.
int run_mta(HWND owner, const std::function<int()>& work) {
    HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!done) return -2;
    bool wasEnabled = IsWindowEnabled(owner) != FALSE;
    if (wasEnabled) EnableWindow(owner, FALSE);
    int result = -2;
    std::thread worker;
    try {
        worker = std::thread([&] {
            try {
                init_apartment(apartment_type::multi_threaded);
                struct Apartment { ~Apartment() { uninit_apartment(); } } apartment;
                result = work();
            } catch (...) { result = -2; }
            SetEvent(done);
        });
    } catch (...) {
        if (wasEnabled) EnableWindow(owner, TRUE);
        CloseHandle(done); return -2;
    }
    bool quitting = false; int quitCode = 0;
    while (MsgWaitForMultipleObjects(1, &done, FALSE, INFINITE, QS_ALLINPUT) == WAIT_OBJECT_0 + 1) {
        MSG message;
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
            if (message.message == WM_QUIT) { quitting = true; quitCode = (int)message.wParam; }
            else { TranslateMessage(&message); DispatchMessageW(&message); }
        }
    }
    worker.join(); CloseHandle(done);
    if (wasEnabled && IsWindow(owner)) EnableWindow(owner, TRUE);
    if (quitting) PostQuitMessage(quitCode);
    return result;
}
struct PrintResources {
    PRINTDLGEXW dialog{};
    bool started = false;
    ~PrintResources() {
        if (started && dialog.hDC) AbortDoc(dialog.hDC);
        if (dialog.hDC) DeleteDC(dialog.hDC);
        if (dialog.hDevMode) GlobalFree(dialog.hDevMode);
        if (dialog.hDevNames) GlobalFree(dialog.hDevNames);
    }
};
}
extern "C" int paperdesk_print(void* owner, const uint8_t* marked, size_t markedLen,
    const uint8_t* clean, size_t cleanLen, const char* title, uint32_t current,
    const uint32_t* selected, size_t selectedLen) {
    try {
        // Tauri invokes this on the owning window thread (already an STA).
        init_apartment(apartment_type::single_threaded);
        struct Apartment { ~Apartment() { uninit_apartment(); } } apartment;
        HWND window = static_cast<HWND>(owner);
        int count = run_mta(window, [&] {
            auto pdf = load_pdf(marked, markedLen);
            return pdf.PageCount() <= INT_MAX ? (int)pdf.PageCount() : -1;
        });
        if (count <= 0) return -1;
        if (!IsWindow(window)) return 0;
        Options options{(uint32_t)count, current, std::vector<uint32_t>(selected, selected + selectedLen), {}};
        options.pages = paperdesk::select_pages(options.count, 0, current, options.selected, "", 0, false);
        // A resource-free native property page, embedded in the single system print dialog.
        struct alignas(DWORD) Template { DLGTEMPLATE dlg; WORD menu, cls, title; } layout{};
        layout.dlg.style = WS_CHILD | WS_VISIBLE | DS_CONTROL;
        layout.dlg.cx = 252; layout.dlg.cy = 190;
        PROPSHEETPAGEW page{}; page.dwSize = sizeof(page);
        page.dwFlags = PSP_DLGINDIRECT | PSP_USETITLE;
        page.pResource = &layout.dlg; page.pszTitle = L"PaperDesk Pages";
        page.pfnDlgProc = page_proc; page.lParam = reinterpret_cast<LPARAM>(&options);
        HPROPSHEETPAGE property = CreatePropertySheetPageW(&page);
        if (!property) return -2;
        PrintResources resources;
        auto& dialog = resources.dialog;
        dialog.lStructSize = sizeof(dialog); dialog.hwndOwner = static_cast<HWND>(owner);
        dialog.Flags = PD_RETURNDC | PD_NOPAGENUMS | PD_NOSELECTION | PD_NOCURRENTPAGE | PD_USEDEVMODECOPIESANDCOLLATE;
        PRINTPAGERANGE range{1, options.count};
        dialog.lpPageRanges = &range; dialog.nMaxPageRanges = 1;
        dialog.ExclusionFlags = PD_EXCL_COPIESANDCOLLATE;
        dialog.nCopies = 1; dialog.nMinPage = 1; dialog.nMaxPage = options.count;
        dialog.nPropertyPages = 1; dialog.lphPropertyPages = &property; dialog.nStartPage = 0;
        HRESULT result = PrintDlgExW(&dialog);
        // PrintDlgEx destroys the property page handles, including on cancellation.
        if (FAILED(result)) return -2;
        if (dialog.dwResultAction != PD_RESULT_PRINT) return 0;
        if (options.pages.empty() || !dialog.hDC) return -2;
        return run_mta(window, [&] {
            auto pdf = options.annotations || !cleanLen ? load_pdf(marked, markedLen) : load_pdf(clean, cleanLen);
            if (pdf.PageCount() != options.count) return -1;
            HDC dc = dialog.hDC;
            DOCINFOW docInfo{}; docInfo.cbSize = sizeof(docInfo);
            auto jobTitle = to_hstring(title); docInfo.lpszDocName = jobTitle.c_str();
            if (StartDocW(dc, &docInfo) <= 0) return -2;
            resources.started = true;
            int width = GetDeviceCaps(dc, HORZRES), height = GetDeviceCaps(dc, VERTRES);
            int dpiX = GetDeviceCaps(dc, LOGPIXELSX), dpiY = GetDeviceCaps(dc, LOGPIXELSY);
            if (width <= 0 || height <= 0 || dpiX <= 0 || dpiY <= 0) return -2;
            for (auto position : options.pages) {
                auto pdfPage = pdf.GetPage(position - 1);
                auto size = pdfPage.Size();
                if (!std::isfinite(size.Width) || !std::isfinite(size.Height) || size.Width <= 0 || size.Height <= 0) return -1;
                double scale = std::min((double)width / dpiX / size.Width, (double)height / dpiY / size.Height);
                // 300 DPI, capped at 32 megapixels for unusually large media.
                double pixelWidth = size.Width * scale * 300, pixelHeight = size.Height * scale * 300;
                double cap = std::min(1.0, std::sqrt(32000000.0 / (pixelWidth * pixelHeight)));
                PdfPageRenderOptions render;
                render.DestinationWidth(std::max(1u, (uint32_t)(pixelWidth * cap)));
                render.DestinationHeight(std::max(1u, (uint32_t)(pixelHeight * cap)));
                InMemoryRandomAccessStream stream;
                pdfPage.RenderToStreamAsync(stream, render).get(); stream.Seek(0);
                auto decoder = BitmapDecoder::CreateAsync(stream).get();
                auto pixels = decoder.GetPixelDataAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore,
                    BitmapTransform{}, ExifOrientationMode::IgnoreExifOrientation, ColorManagementMode::DoNotColorManage).get().DetachPixelData();
                BITMAPINFO bitmap{}; bitmap.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
                bitmap.bmiHeader.biWidth = decoder.PixelWidth(); bitmap.bmiHeader.biHeight = -(LONG)decoder.PixelHeight();
                bitmap.bmiHeader.biPlanes = 1; bitmap.bmiHeader.biBitCount = 32; bitmap.bmiHeader.biCompression = BI_RGB;
                int outWidth = (int)(size.Width * scale * dpiX), outHeight = (int)(size.Height * scale * dpiY);
                if (StartPage(dc) <= 0) return -2;
                SetStretchBltMode(dc, HALFTONE);
                int drawn = StretchDIBits(dc, (width-outWidth)/2, (height-outHeight)/2, outWidth, outHeight,
                    0, 0, decoder.PixelWidth(), decoder.PixelHeight(), pixels.data(), &bitmap, DIB_RGB_COLORS, SRCCOPY);
                if (drawn == GDI_ERROR || drawn == 0 || EndPage(dc) <= 0) return -2;
                pdfPage.Close();
            }
            if (EndDoc(dc) <= 0) return -2;
            resources.started = false; return 1;
        });
    } catch (...) { return -2; }
}
