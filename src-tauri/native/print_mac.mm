#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>
#include "print_selection.h"

@interface PDPrintView : NSView
@property PDFDocument *marked;
@property PDFDocument *clean;
@property NSArray<NSNumber *> *pages;
@property BOOL annotations;
@property NSPrintInfo *info;
@property NSUInteger drawingPage;
@end
@implementation PDPrintView
- (BOOL)knowsPageRange:(NSRangePointer)range {
    *range = NSMakeRange(1, self.pages.count); return YES;
}
- (NSRect)rectForPage:(NSInteger)page {
    self.drawingPage = page;
    NSSize size = self.info.paperSize;
    NSRect rect = NSMakeRect(0, 0, size.width, size.height);
    self.frame = rect; return rect;
}
- (void)drawRect:(NSRect)dirtyRect {
    if (!self.drawingPage || self.drawingPage > self.pages.count) return;
    PDFDocument *document = self.annotations ? self.marked : self.clean;
    PDFPage *page = [document pageAtIndex:self.pages[self.drawingPage - 1].unsignedIntegerValue - 1];
    if (!page) return;
    CGContextRef context = NSGraphicsContext.currentContext.CGContext;
    CGContextSaveGState(context);
    NSRect area = self.info.imageablePageBounds;
    // PDFKit applies the page's rotation/crop transform and retains source annotations.
    CGRect bounds = CGRectApplyAffineTransform([page boundsForBox:kPDFDisplayBoxCropBox],
        [page transformForBox:kPDFDisplayBoxCropBox]);
    if (bounds.size.width > 0 && bounds.size.height > 0) {
        CGFloat scale = MIN(area.size.width / bounds.size.width, area.size.height / bounds.size.height);
        CGContextTranslateCTM(context, area.origin.x + (area.size.width - bounds.size.width * scale) / 2,
            area.origin.y + (area.size.height - bounds.size.height * scale) / 2);
        CGContextScaleCTM(context, scale, scale);
        CGContextTranslateCTM(context, -bounds.origin.x, -bounds.origin.y);
        [page drawWithBox:kPDFDisplayBoxCropBox toContext:context];
    }
    CGContextRestoreGState(context);
}
@end

@interface PDPrintOptions : NSViewController <NSPrintPanelAccessorizing, NSTextFieldDelegate>
@property PDPrintView *printView;
@property NSPopUpButton *scope;
@property NSPopUpButton *parity;
@property NSTextField *ranges;
@property NSButton *reverse;
@property NSButton *annotations;
@property NSTextField *summary;
@property NSArray<NSNumber *> *selected;
@property uint32_t current;
@property NSUInteger revision;
@end
@implementation PDPrintOptions
- (void)loadView {
    self.title = @"PaperDesk Pages";
    self.view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 360, 230)];
    self.scope = [[NSPopUpButton alloc] initWithFrame:NSMakeRect(130, 192, 220, 26)];
    [self.scope addItemsWithTitles:@[@"All pages", @"Current page", @"Selected thumbnails", @"Custom range"]];
    self.parity = [[NSPopUpButton alloc] initWithFrame:NSMakeRect(130, 122, 220, 26)];
    [self.parity addItemsWithTitles:@[@"All", @"Odd pages only", @"Even pages only"]];
    self.ranges = [[NSTextField alloc] initWithFrame:NSMakeRect(130, 158, 220, 24)];
    self.scope.accessibilityLabel = @"Pages";
    self.parity.accessibilityLabel = @"Print odd or even document pages";
    self.ranges.accessibilityLabel = @"Page range";
    self.ranges.placeholderString = @"1–3, 7, 10–12"; self.ranges.delegate = self;
    self.reverse = [NSButton checkboxWithTitle:@"Reverse order" target:self action:@selector(changed:)];
    self.reverse.frame = NSMakeRect(130, 90, 220, 24);
    self.annotations = [NSButton checkboxWithTitle:@"Include annotations" target:self action:@selector(changed:)];
    self.annotations.frame = NSMakeRect(130, 60, 220, 24); self.annotations.state = NSControlStateValueOn;
    self.summary = [NSTextField wrappingLabelWithString:@""];
    self.summary.frame = NSMakeRect(10, 0, 340, 52);
    NSArray *titles = @[@"Pages", @"Range", @"Print"];
    NSArray *ys = @[@196, @162, @126];
    for (NSUInteger i = 0; i < titles.count; ++i) {
        NSTextField *label = [NSTextField labelWithString:titles[i]];
        label.frame = NSMakeRect(10, [ys[i] doubleValue], 110, 20); [self.view addSubview:label];
    }
    for (NSControl *control in @[self.scope, self.parity, self.ranges, self.reverse, self.annotations, self.summary]) [self.view addSubview:control];
    self.scope.target = self; self.scope.action = @selector(changed:);
    self.parity.target = self; self.parity.action = @selector(changed:);
    [self changed:nil];
}
- (void)controlTextDidChange:(NSNotification *)notification { [self changed:nil]; }
- (void)changed:(id)sender {
    self.ranges.enabled = self.scope.indexOfSelectedItem == 3;
    std::vector<uint32_t> selected;
    for (NSNumber *n in self.selected) selected.push_back(n.unsignedIntValue);
    try {
        auto pages = paperdesk::select_pages((uint32_t)self.printView.marked.pageCount,
            (int)self.scope.indexOfSelectedItem, self.current, selected,
            self.ranges.stringValue.UTF8String, (int)self.parity.indexOfSelectedItem,
            self.reverse.state == NSControlStateValueOn);
        NSMutableArray *values = [NSMutableArray array];
        for (auto n : pages) [values addObject:@(n)];
        self.printView.pages = values;
        self.summary.stringValue = [NSString stringWithFormat:@"%lu pages • Document page numbers", (unsigned long)pages.size()];
        self.summary.textColor = NSColor.secondaryLabelColor;
    } catch (const std::exception& error) {
        self.printView.pages = @[];
        self.summary.stringValue = @(error.what()); self.summary.textColor = NSColor.systemRedColor;
    }
    self.printView.annotations = self.annotations.state == NSControlStateValueOn;
    self.revision += 1;
}
- (NSArray *)localizedSummaryItems {
    return @[@{NSPrintPanelAccessorySummaryItemNameKey: @"PaperDesk pages", NSPrintPanelAccessorySummaryItemDescriptionKey: self.summary.stringValue}];
}
- (NSSet *)keyPathsForValuesAffectingPreview { return [NSSet setWithObject:@"revision"]; }
@end

// NSPrintOperation must own the panel lifecycle for native preview generation.
@interface PDPrintPanel : NSPrintPanel
@property PDPrintView *documentView;
@property BOOL accepted;
@end
@implementation PDPrintPanel
- (NSInteger)runModalWithPrintInfo:(NSPrintInfo *)info {
    while (true) {
        NSInteger response = [super runModalWithPrintInfo:info];
        if (response != NSModalResponseOK) return response;
        if (self.documentView.pages.count) { self.accepted = YES; return response; }
        NSBeep();
    }
}
@end

extern "C" int paperdesk_print(void *owner, const uint8_t *marked, size_t markedLen,
    const uint8_t *clean, size_t cleanLen, const char *title, uint32_t current,
    const uint32_t *selected, size_t selectedLen) {
    @autoreleasepool {
        @try {
            PDPrintView *view = [[PDPrintView alloc] initWithFrame:NSMakeRect(0, 0, 595, 842)];
            view.marked = [[PDFDocument alloc] initWithData:[NSData dataWithBytes:marked length:markedLen]];
            view.clean = cleanLen ? [[PDFDocument alloc] initWithData:[NSData dataWithBytes:clean length:cleanLen]] : view.marked;
            if (!view.marked.pageCount || view.marked.pageCount != view.clean.pageCount) return -1;
            NSPrintInfo *info = [NSPrintInfo.sharedPrintInfo copy];
            info.topMargin = info.bottomMargin = info.leftMargin = info.rightMargin = 0;
            info.horizontalPagination = NSPrintingPaginationModeClip;
            info.verticalPagination = NSPrintingPaginationModeClip;
            info.dictionary[NSPrintAllPages] = @YES;
            view.info = info;
            if (owner) [(__bridge NSWindow *)owner makeKeyAndOrderFront:nil];
            PDPrintOptions *options = [PDPrintOptions new]; options.printView = view; options.current = current;
            NSMutableArray *selection = [NSMutableArray array];
            for (size_t i = 0; i < selectedLen; ++i) [selection addObject:@(selected[i])];
            options.selected = selection;
            [options view];
            NSPrintOperation *operation = [NSPrintOperation printOperationWithView:view printInfo:info];
            view.info = operation.printInfo;
            PDPrintPanel *panel = [[PDPrintPanel alloc] init];
            panel.documentView = view;
            operation.printPanel = panel;
            operation.jobTitle = [NSString stringWithUTF8String:title];
            operation.printPanel.options = NSPrintPanelShowsCopies | NSPrintPanelShowsPaperSize | NSPrintPanelShowsOrientation | NSPrintPanelShowsScaling | NSPrintPanelShowsPreview;
            [operation.printPanel addAccessoryController:options];
            BOOL success = [operation runOperation];
            return success ? 1 : (panel.accepted ? -2 : 0);
        } @catch (NSException *exception) { return -2; }
    }
}
