import { describe, expect, it } from 'vitest';

import desktopCapability from '../../../src-tauri/capabilities/default.json';

describe('desktop PDF export capabilities', () => {
  it('allows the confirmation dialog required before replacing a source PDF', () => {
    expect(desktopCapability.permissions).toContain('dialog:allow-message');
  });
});
