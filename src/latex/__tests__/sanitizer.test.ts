import assert from 'node:assert/strict';
import test from 'node:test';
import {
  containsDangerousLatexMacro,
  escapeLatex,
  escapeLatexMultiline,
  renderLatexTemplate,
} from '../sanitizer.js';

test('escapeLatex mengubah seluruh 10 karakter khusus LaTeX secara akurat', () => {
  const input = String.raw`A\B {C} $100 & #1 _test_ 50% ~ ^2`;
  const escaped = escapeLatex(input);

  assert.equal(
    escaped,
    String.raw`A\textbackslash{}B \{C\} \$100 \& \#1 \_test\_ 50\% \textasciitilde{} \textasciicircum{}2`,
  );
});

test('escapeLatex menetralkan percobaan LaTeX Injection / RCE', () => {
  const malicious = String.raw`\immediate\write18{rm -rf /} \input{/etc/passwd}`;
  assert.equal(containsDangerousLatexMacro(malicious), true);

  const escaped = escapeLatex(malicious);
  assert.equal(
    escaped,
    String.raw`\textbackslash{}immediate\textbackslash{}write18\{rm -rf /\} \textbackslash{}input\{/etc/passwd\}`,
  );
  // Pastikan tidak ada backslash mentah yang membentuk makro aktif selain perintah escaping aman
  assert.ok(!escaped.includes('\\write18'));
  assert.ok(!escaped.includes('\\input'));
});

test('escapeLatexMultiline mengubah baris baru menjadi line break LaTeX', () => {
  const escaped = escapeLatexMultiline('Dus ke-1: 100%\nDus ke-2: $50 & aman');
  assert.equal(escaped, String.raw`Dus ke-1: 100\% \\ Dus ke-2: \$50 \& aman`);
});

test('renderLatexTemplate menolak placeholder yang belum diisi', () => {
  assert.throws(() => {
    renderLatexTemplate('Nomor: {{DOC_NUMBER}} - {{MISSING_VAR}}', {
      DOC_NUMBER: { kind: 'text', value: 'SJ/GDG-A/202611/000001' },
    });
  }, /MISSING_VAR/);
});
