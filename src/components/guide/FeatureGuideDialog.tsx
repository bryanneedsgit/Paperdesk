import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';

import { featureGuideSections, type FeatureGuideSection } from './guideContent';

type FeatureGuideDialogProps = {
  onClose: () => void;
};

type FeatureGuideCarouselProps = {
  guide: FeatureGuideSection;
};

function FeatureGuideCarousel({ guide }: FeatureGuideCarouselProps) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const slideCount = guide.screenshots.length;
  const activeSlide = guide.screenshots[activeSlideIndex];

  if (!activeSlide || slideCount === 0) {
    return null;
  }

  const showPreviousSlide = () => {
    setActiveSlideIndex((currentIndex) => (currentIndex === 0 ? slideCount - 1 : currentIndex - 1));
  };

  const showNextSlide = () => {
    setActiveSlideIndex((currentIndex) => (currentIndex + 1) % slideCount);
  };

  return (
    <div className="feature-guide-carousel" aria-label={`${guide.title} screenshots`}>
      <div className="feature-guide-carousel-frame">
        {activeSlide.imageSrc ? (
          <img alt={activeSlide.alt} src={activeSlide.imageSrc} />
        ) : (
          <div className="feature-guide-screenshot-placeholder" aria-label={activeSlide.alt}>
            <span>{activeSlide.label}</span>
          </div>
        )}
      </div>

      <div className="feature-guide-carousel-controls">
        <button
          aria-label={`Previous ${guide.title} screenshot`}
          className="feature-guide-carousel-button"
          onClick={showPreviousSlide}
          type="button"
        >
          <ChevronLeft size={15} />
        </button>
        <p>{activeSlide.caption}</p>
        <button
          aria-label={`Next ${guide.title} screenshot`}
          className="feature-guide-carousel-button"
          onClick={showNextSlide}
          type="button"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="feature-guide-carousel-dots" aria-label={`${guide.title} screenshot list`}>
        {guide.screenshots.map((screenshot, index) => (
          <button
            aria-label={`Show ${screenshot.label}`}
            aria-pressed={index === activeSlideIndex}
            key={screenshot.label}
            onClick={() => setActiveSlideIndex(index)}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}

export function FeatureGuideDialog({ onClose }: FeatureGuideDialogProps) {
  const [activeGuideId, setActiveGuideId] = useState(featureGuideSections[0]?.id ?? '');
  const activeGuide =
    featureGuideSections.find((guide) => guide.id === activeGuideId) ?? featureGuideSections[0];
  const activeGuideShortcuts = activeGuide.shortcuts ?? [];
  const showCarousel = activeGuide.screenshots.length > 0;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="feature-guide-title"
        aria-modal="true"
        className="app-dialog feature-guide-dialog"
        role="dialog"
      >
        <header className="modal-header feature-guide-header">
          <div>
            <h2 id="feature-guide-title">Feature guide</h2>
            <p>Step through Paperdesk workflows with guided visuals for each feature.</p>
          </div>
          <button
            aria-label="Close"
            className="modal-close-button"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={14} />
          </button>
        </header>

        <div className="feature-guide-layout">
          <nav className="feature-guide-nav" aria-label="Feature guide sections">
            {featureGuideSections.map((guide) => (
              <button
                aria-current={guide.id === activeGuide.id ? 'page' : undefined}
                key={guide.id}
                onClick={() => setActiveGuideId(guide.id)}
                type="button"
              >
                <strong>{guide.title}</strong>
                <span>{guide.summary}</span>
              </button>
            ))}
          </nav>

          <article
            className="feature-guide-detail"
            data-has-carousel={showCarousel ? 'true' : 'false'}
          >
            <header>
              <h3>{activeGuide.title}</h3>
              <p>{activeGuide.summary}</p>
            </header>

            {showCarousel ? <FeatureGuideCarousel guide={activeGuide} /> : null}

            <div className="feature-guide-detail-grid">
              {activeGuideShortcuts.length ? (
                <section className="feature-guide-shortcuts-section">
                  <h4>Keystrokes</h4>
                  <dl className="feature-guide-shortcut-list">
                    {activeGuideShortcuts.map((shortcut) => (
                      <div key={shortcut.keystroke}>
                        <dt>
                          <kbd>{shortcut.keystroke}</kbd>
                        </dt>
                        <dd>{shortcut.action}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : (
                <section>
                  <h4>Workflow</h4>
                  <ol>
                    {activeGuide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </section>
              )}

              <section>
                <h4>Notes</h4>
                <ul>
                  {activeGuide.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </section>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
