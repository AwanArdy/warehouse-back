const DANGEROUES_LATEX_PATTERNS: readonly RegExp[] = [
  /\\write18\b/i,
  /\\immediate\b/i,
  /\\input\b/i,
  /\\include\b/i,
  /\\openout\b/i,
  /\\openin\b/i,
  /\\read\b/i,
  /\\catcode\b/i,
  /\\csname\b/i,
  /\\directlua\b/i,
  /\\latelua\b/i,
  /\\usepackage\b/i,
  /\\documentclass\b/i,
];

export function containsDangerousLatexMacro(raw: string): boolean {
  return DANGEROUES_LATEX_PATTERNS.some((pattern) => pattern.test(raw))
}

export function escapeLatex(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }

  const str = String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r\n|\r|\n/g, ' ')
    .trim();

  if (str.length === 0) {
    return '-';
  }

  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/%/g, '\\%')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

export function escapeLatexMultiline(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) {
    return '-';
  }

  const lines = String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .split(/\r\n|\r|\n/)
    .map((line) => escapeLatex(line));

  return lines.join(' \\\\ ');
}

export type TemplateVariables = Record<
  string,
  | { kind: 'text'; value: string | number | boolean | null | undefined  }
  | { kind: 'multiline'; value: string | null | undefined }
  | { kind: 'trusted_latex'; value: string }
>;

export function renderLatexTemplate(templateSource: string, variables: TemplateVariables): string {
  return templateSource.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const entry = variables[key];
    if (!entry) {
      throw new Error(`Variabel template LaTeX '{{${key}}}' belum disediakan`);
    }

    switch (entry.kind) {
      case 'text':
        return escapeLatexMultiline(entry.value);
      case 'multiline':
        return escapeLatexMultiline(entry.value);
      case 'trusted_latex':
        return entry.value;
    }
  });
}
