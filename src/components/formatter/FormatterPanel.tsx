import { FilePlus2, FileText } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatterFontOptions } from '../../lib/pdf/formatterOptions';
import type { FormatterSettings, PdfCropMargins, PdfWorkspace } from '../../lib/pdf/types';

type FormatterPanelProps = {
  onChangeSettings: (settings: Partial<FormatterSettings>) => void;
  onInsertBlankPage: () => void;
  onInsertCoverPage: () => void;
  workspace: PdfWorkspace | null;
};

type FieldProps = {
  children: ReactNode;
  label: string;
};

function Field({ children, label }: FieldProps) {
  return (
    <label className="formatter-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

export function FormatterPanel({
  onChangeSettings,
  onInsertBlankPage,
  onInsertCoverPage,
  workspace,
}: FormatterPanelProps) {
  const settings = workspace?.formatterSettings;

  if (!workspace || !settings) {
    return (
      <div className="tool-stack">
        <section className="tool-section">
          <h3>Formatter</h3>
          <p className="tool-empty-copy">Open a PDF to format pages.</p>
        </section>
      </div>
    );
  }

  const updateCropMargin = (key: keyof PdfCropMargins, value: number) => {
    onChangeSettings({
      cropMargins: {
        ...settings.cropMargins,
        [key]: clampNumber(value, 0, 999),
      },
    });
  };

  return (
    <div className="tool-stack formatter-panel">
      <section className="tool-section">
        <h3>Page Numbers</h3>
        <label className="formatter-check">
          <input
            checked={settings.pageNumbersEnabled}
            onChange={(event) => onChangeSettings({ pageNumbersEnabled: event.target.checked })}
            type="checkbox"
          />
          <span>Show page numbers</span>
        </label>
        <Field label="Position">
          <select
            onChange={(event) =>
              onChangeSettings({
                pageNumberPosition: event.target.value as FormatterSettings['pageNumberPosition'],
              })
            }
            value={settings.pageNumberPosition}
          >
            <option value="bottom-center">Bottom center</option>
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
          </select>
        </Field>
        <Field label="Start number">
          <input
            min={1}
            onChange={(event) =>
              onChangeSettings({ startNumber: clampNumber(event.target.valueAsNumber, 1, 99999) })
            }
            type="number"
            value={settings.startNumber}
          />
        </Field>
      </section>

      <section className="tool-section">
        <h3>Text Overlays</h3>
        <Field label="Font">
          <select
            onChange={(event) =>
              onChangeSettings({
                fontFamily: event.target.value as FormatterSettings['fontFamily'],
              })
            }
            value={settings.fontFamily}
          >
            {formatterFontOptions.map((fontOption) => (
              <option key={fontOption.id} value={fontOption.id}>
                {fontOption.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Header">
          <input
            onChange={(event) => onChangeSettings({ headerText: event.target.value })}
            type="text"
            value={settings.headerText}
          />
        </Field>
        <Field label="Footer">
          <input
            onChange={(event) => onChangeSettings({ footerText: event.target.value })}
            type="text"
            value={settings.footerText}
          />
        </Field>
        <div className="formatter-group">
          <h4>Watermark</h4>
          <Field label="Text">
            <input
              onChange={(event) => onChangeSettings({ watermarkText: event.target.value })}
              type="text"
              value={settings.watermarkText}
            />
          </Field>
          <Field label={`Opacity ${Math.round(settings.watermarkOpacity * 100)}%`}>
            <input
              max={1}
              min={0}
              onChange={(event) =>
                onChangeSettings({
                  watermarkOpacity: clampNumber(event.target.valueAsNumber, 0, 1),
                })
              }
              step={0.01}
              type="range"
              value={settings.watermarkOpacity}
            />
          </Field>
        </div>
      </section>

      <section className="tool-section">
        <h3>Apply</h3>
        <div className="formatter-segmented" role="group" aria-label="Apply formatter to">
          <button
            aria-pressed={settings.applyScope === 'all'}
            onClick={() => onChangeSettings({ applyScope: 'all' })}
            type="button"
          >
            All pages
          </button>
          <button
            aria-pressed={settings.applyScope === 'selected'}
            onClick={() => onChangeSettings({ applyScope: 'selected' })}
            type="button"
          >
            Selected
          </button>
        </div>
      </section>

      <section className="tool-section">
        <h3>Insert Pages</h3>
        <div className="formatter-button-row">
          <button className="secondary-action-button" onClick={onInsertBlankPage} type="button">
            <FilePlus2 size={15} />
            <span>Blank</span>
          </button>
          <button className="secondary-action-button" onClick={onInsertCoverPage} type="button">
            <FileText size={15} />
            <span>Cover</span>
          </button>
        </div>
        <Field label="Cover title">
          <input
            onChange={(event) => onChangeSettings({ coverTitle: event.target.value })}
            type="text"
            value={settings.coverTitle}
          />
        </Field>
        <Field label="Subtitle">
          <input
            onChange={(event) => onChangeSettings({ coverSubtitle: event.target.value })}
            type="text"
            value={settings.coverSubtitle}
          />
        </Field>
        <Field label="Date">
          <input
            onChange={(event) => onChangeSettings({ coverDate: event.target.value })}
            type="text"
            value={settings.coverDate}
          />
        </Field>
      </section>

      <section className="tool-section">
        <h3>Page Size</h3>
        <Field label="Resize">
          <select
            onChange={(event) =>
              onChangeSettings({
                resizePageSize: event.target.value as FormatterSettings['resizePageSize'],
              })
            }
            value={settings.resizePageSize}
          >
            <option value="keep-original">Keep original</option>
            <option value="a4-portrait">A4 portrait</option>
            <option value="a4-landscape">A4 landscape</option>
            <option value="letter-portrait">Letter portrait</option>
            <option value="letter-landscape">Letter landscape</option>
          </select>
        </Field>
      </section>

      <section className="tool-section">
        <h3>Crop Margins</h3>
        <div className="formatter-crop-grid">
          {(['top', 'right', 'bottom', 'left'] as const).map((key) => (
            <Field label={key[0].toUpperCase() + key.slice(1)} key={key}>
              <input
                min={0}
                onChange={(event) => updateCropMargin(key, event.target.valueAsNumber)}
                type="number"
                value={settings.cropMargins[key]}
              />
            </Field>
          ))}
        </div>
      </section>
    </div>
  );
}
