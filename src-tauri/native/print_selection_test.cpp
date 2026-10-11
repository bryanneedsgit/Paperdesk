#include "print_selection.h"
#include <cassert>
#include <iostream>
int main() {
    using paperdesk::select_pages;
    assert((select_pages(8, 3, 1, {}, "2-7", 1, false) == std::vector<uint32_t>{3, 5, 7}));
    assert((select_pages(8, 3, 1, {}, "2-7", 2, true) == std::vector<uint32_t>{6, 4, 2}));
    assert((select_pages(8, 3, 1, {}, "1–3, 3, 7-8", 0, false) == std::vector<uint32_t>{1, 2, 3, 7, 8}));
    assert((select_pages(8, 2, 1, {7, 2, 2, 4}, "", 2, true) == std::vector<uint32_t>{4, 2}));
    assert((select_pages(8, 1, 6, {}, "", 2, false) == std::vector<uint32_t>{6}));
    for (auto invalid : {"", "0", "9", "4-2", "1,", "-1", "1,,2", "1.5", "1 2", "99999999999999999999"}) {
        bool rejected = false;
        try { select_pages(8, 3, 1, {}, invalid, 0, false); } catch (const std::exception&) { rejected = true; }
        assert(rejected);
    }
    bool empty = false;
    try { select_pages(1, 0, 1, {}, "", 2, false); } catch (const std::exception&) { empty = true; }
    assert(empty);
    std::cout << "Print page selection tests passed\n";
}
