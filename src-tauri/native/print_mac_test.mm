// Standalone native rendering regression: no dialog, printer, or spool job.
#include "print_mac.mm"
#include <cassert>
#include <iostream>
#import <CoreText/CoreText.h>
static PDFDocument *fixture() {
    NSMutableData *data = [NSMutableData data];
    CGDataConsumerRef consumer = CGDataConsumerCreateWithCFData((__bridge CFMutableDataRef)data);
    CGRect box = CGRectMake(0, 0, 200, 300);
    CGContextRef context = CGPDFContextCreate(consumer, &box, nullptr);
    for (int n = 1; n <= 7; ++n) {
        CGPDFContextBeginPage(context, nullptr);
        NSAttributedString *text = [[NSAttributedString alloc] initWithString:[NSString stringWithFormat:@"PAGE %d", n]
            attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:24]}];
        CTLineRef line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)text);
        CGContextSetTextPosition(context, 30, 150); CTLineDraw(line, context); CFRelease(line);
        CGPDFContextEndPage(context);
    }
    CGPDFContextClose(context); CGContextRelease(context); CGDataConsumerRelease(consumer);
    return [[PDFDocument alloc] initWithData:data];
}
int main() {
    @autoreleasepool {
        PDPrintView *view = [[PDPrintView alloc] initWithFrame:NSMakeRect(0, 0, 200, 300)];
        view.marked = fixture(); view.clean = view.marked; view.annotations = YES;
        PDFPage *rotated = [view.marked pageAtIndex:4];
        rotated.rotation = 90;
        [rotated setBounds:CGRectMake(20, 100, 150, 150) forBox:kPDFDisplayBoxCropBox];
        PDFAnnotation *sourceNote = [[PDFAnnotation alloc] initWithBounds:CGRectMake(20, 50, 160, 30)
            forType:PDFAnnotationSubtypeFreeText withProperties:nil];
        sourceNote.contents = @"SOURCE NOTE";
        sourceNote.font = [NSFont systemFontOfSize:12];
        [[view.marked pageAtIndex:6] addAnnotation:sourceNote];
        view.pages = @[@7, @5, @3];
        NSPrintInfo *info = [[NSPrintInfo alloc] initWithDictionary:@{}];
        info.paperSize = NSMakeSize(200, 300);
        info.topMargin = info.bottomMargin = info.leftMargin = info.rightMargin = 0;
        view.info = info;
        NSURL *output = [[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES]
            URLByAppendingPathComponent:[NSUUID.UUID.UUIDString stringByAppendingString:@".pdf"]];
        info.jobDisposition = NSPrintSaveJob;
        info.dictionary[NSPrintJobSavingURL] = output;
        NSPrintOperation *operation = [NSPrintOperation printOperationWithView:view printInfo:info];
        view.info = operation.printInfo;
        operation.showsPrintPanel = NO; operation.showsProgressPanel = NO;
        assert([operation runOperation]);
        PDFDocument *pdf = [[PDFDocument alloc] initWithURL:output];
        assert(pdf.pageCount == 3);
        assert([[pdf pageAtIndex:0].string containsString:@"PAGE 7"]);
        assert([[pdf pageAtIndex:1].string containsString:@"PAGE 5"]);
        assert([[pdf pageAtIndex:2].string containsString:@"PAGE 3"]);
        assert([[pdf pageAtIndex:0].string containsString:@"SOURCE NOTE"]);
        PDFSelection *selection = [pdf findString:@"PAGE 5" withOptions:0].firstObject;
        assert(selection != nil);
        assert(CGRectContainsRect([[pdf pageAtIndex:1] boundsForBox:kPDFDisplayBoxMediaBox],
            [selection boundsForPage:[pdf pageAtIndex:1]]));
        [[NSFileManager defaultManager] removeItemAtURL:output error:nil];
        std::cout << "Native PDF rendering preserved filtered order and text\n";
    }
}
