import { applyAppearanceResync } from '../with-appearance-resync';

// The part of React Native's MainActivity.kt template this plugin rewrites.
const template = `class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript.
   */
  override fun getMainComponentName(): String = "main"
}
`;

describe('applyAppearanceResync', () => {
  const result = applyAppearanceResync(template);

  it('forwards the current configuration to React Native on every resume', () => {
    expect(result).toMatch(
      /override fun onResume\(\) \{\s*super\.onResume\(\)\s*reactActivityDelegate\.onConfigurationChanged\(resources\.configuration\)\s*\}/,
    );
  });

  it('adds it as the last member, leaving every other member beside its own doc comment', () => {
    expect(result).toMatch(/\*\/\n  override fun getMainComponentName\(\)/);
    expect(result.trimEnd()).toMatch(/onConfigurationChanged\(resources\.configuration\)\n  \}\n\}$/);
  });

  it('keeps the rest of the activity intact', () => {
    expect(result).toContain('super.onCreate(null)');
    expect(result).toContain('override fun getMainComponentName(): String = "main"');
  });

  it('is a no-op on a file it has already rewritten', () => {
    expect(applyAppearanceResync(result)).toBe(result);
  });

  it('refuses a template it does not recognise', () => {
    expect(() => applyAppearanceResync('class MainActivity')).toThrow(/template, which has changed/);
  });

  it('refuses an activity that already overrides onResume', () => {
    const withResume = template.replace('  override fun onCreate', '  override fun onResume() {}\n  override fun onCreate');
    expect(() => applyAppearanceResync(withResume)).toThrow(/template, which has changed/);
  });
});
