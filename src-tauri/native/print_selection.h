#pragma once
#include <algorithm>
#include <cstdint>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace paperdesk {
// Positions always refer to the complete, edited document (one-based).
inline std::vector<uint32_t> select_pages(uint32_t count, int scope, uint32_t current,
    const std::vector<uint32_t>& selected, std::string ranges, int parity, bool reverse) {
    std::set<uint32_t> pages;
    auto add = [&](uint32_t n) {
        if (!n || n > count) throw std::runtime_error("Page number is outside this document.");
        pages.insert(n);
    };
    if (scope == 0) { for (uint32_t n = 1; n <= count; ++n) add(n); }
    else if (scope == 1) add(current);
    else if (scope == 2) { for (auto n : selected) add(n); }
    else if (scope == 3) {
        // Accept the en dash commonly used when writing page ranges.
        for (size_t p; (p = ranges.find("\xE2\x80\x93")) != std::string::npos;) ranges.replace(p, 3, "-");
        size_t i = 0;
        auto space = [&] { while (i < ranges.size() && (ranges[i] == ' ' || ranges[i] == '\t')) ++i; };
        auto number = [&]() {
            space(); uint64_t n = 0; size_t start = i;
            while (i < ranges.size() && ranges[i] >= '0' && ranges[i] <= '9') {
                n = n * 10 + ranges[i++] - '0';
                if (n > count) throw std::runtime_error("Page number is outside this document.");
            }
            if (start == i || n == 0) throw std::runtime_error("Use page ranges such as 1-3, 7, 10-12.");
            space(); return static_cast<uint32_t>(n);
        };
        do {
            auto first = number(), last = first;
            if (i < ranges.size() && ranges[i] == '-') { ++i; last = number(); }
            if (last < first) throw std::runtime_error("A page range must run from low to high.");
            for (auto n = first; n <= last; ++n) add(n);
            if (i == ranges.size()) break;
            if (ranges[i++] != ',') throw std::runtime_error("Separate page ranges with commas.");
        } while (true);
    } else throw std::runtime_error("Invalid page selection.");
    std::vector<uint32_t> result;
    for (auto n : pages) if (parity == 0 || (parity == 1 && n % 2) || (parity == 2 && !(n % 2))) result.push_back(n);
    if (result.empty()) throw std::runtime_error("No pages match this selection.");
    if (reverse) std::reverse(result.begin(), result.end());
    return result;
}
}
