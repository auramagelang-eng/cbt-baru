import React, { useState, useMemo } from 'react';
import { Copy, Check, Code } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

interface TokenRule {
  pattern: RegExp;
  className?: string;
}

const getLanguageRules = (lang: string): TokenRule[] => {
  const normalized = lang.toLowerCase().trim();

  if (normalized === 'php') {
    return [
      { pattern: /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//y, className: 'text-zinc-500 italic' },
      { pattern: /<\?(?:php|=)?|\?>/iy, className: 'text-rose-400 font-bold' },
      { pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, className: 'text-emerald-300' },
      { pattern: /\$[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*/y, className: 'text-amber-300 font-medium' },
      { pattern: /\b\d+(?:\.\d+)?\b/y, className: 'text-purple-400 font-semibold' },
      { pattern: /\b(?:echo|print|function|return|if|else|elseif|endif|while|do|for|foreach|as|switch|case|break|continue|default|new|class|extends|implements|public|private|protected|static|final|abstract|interface|trait|use|namespace|const|var|true|false|null|try|catch|finally|throw|include|include_once|require|require_once|isset|empty|array|die|exit)\b/iy, className: 'text-sky-400 font-bold' },
      { pattern: /[=+\-*/%&|!<>?:;.,{}()[\]]+/y, className: 'text-zinc-400' },
      { pattern: /[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*/y, className: 'text-zinc-100' },
      { pattern: /\s+/y },
      { pattern: /./y },
    ];
  }

  if (normalized === 'sql') {
    return [
      { pattern: /--[^\n]*|\/\*[\s\S]*?\*\//y, className: 'text-zinc-500 italic' },
      { pattern: /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/y, className: 'text-emerald-300' },
      { pattern: /\b\d+(?:\.\d+)?\b/y, className: 'text-purple-400 font-semibold' },
      { pattern: /\b(?:SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|ON|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|UNION|ALL|AND|OR|NOT|IN|BETWEEN|LIKE|IS|NULL|AS|CREATE|ALTER|DROP|TABLE|DATABASE|INDEX|VIEW|PRIMARY\s+KEY|FOREIGN\s+KEY|REFERENCES|CASCADE|DEFAULT|CHECK|UNIQUE|AUTO_INCREMENT|DISTINCT|COUNT|SUM|AVG|MIN|MAX|EXISTS|CASE|WHEN|THEN|ELSE|END|TRUNCATE|DESC|ASC)\b/iy, className: 'text-emerald-400 font-bold' },
      { pattern: /\b(?:INT|INTEGER|BIGINT|SMALLINT|TINYINT|VARCHAR|CHAR|TEXT|LONGTEXT|DATE|DATETIME|TIMESTAMP|TIME|DECIMAL|NUMERIC|FLOAT|DOUBLE|BOOLEAN|BOOL)\b/iy, className: 'text-sky-300 font-bold' },
      { pattern: /[=<>!+\-*/%&|~^]+|[;,.(){}[\]]/y, className: 'text-zinc-400' },
      { pattern: /[a-zA-Z_][a-zA-Z0-9_]*/y, className: 'text-zinc-100' },
      { pattern: /\s+/y },
      { pattern: /./y },
    ];
  }

  if (normalized === 'html' || normalized === 'xml') {
    return [
      { pattern: /<!--[\s\S]*?-->/y, className: 'text-zinc-500 italic' },
      { pattern: /<\/?[a-zA-Z0-9:-]+/y, className: 'text-teal-400 font-bold' },
      { pattern: /\/?>/y, className: 'text-teal-400 font-bold' },
      { pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, className: 'text-emerald-300' },
      { pattern: /[a-zA-Z0-9_:-]+(?=\s*=)/y, className: 'text-amber-300' },
      { pattern: /&[a-zA-Z0-9#]+;/y, className: 'text-rose-400' },
      { pattern: /[=]+/y, className: 'text-zinc-400' },
      { pattern: /\s+/y },
      { pattern: /./y, className: 'text-zinc-200' },
    ];
  }

  if (normalized === 'javascript' || normalized === 'js' || normalized === 'typescript' || normalized === 'ts') {
    return [
      { pattern: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y, className: 'text-zinc-500 italic' },
      { pattern: /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, className: 'text-emerald-300' },
      { pattern: /\b\d+(?:\.\d+)?\b/y, className: 'text-purple-400 font-semibold' },
      { pattern: /\b(?:const|let|var|function|return|if|else|switch|case|break|continue|default|for|while|do|in|of|class|extends|constructor|super|this|new|import|export|from|as|async|await|try|catch|finally|throw|typeof|instanceof|void|yield|null|undefined|true|false|interface|type|enum|implements|public|private|protected|readonly)\b/y, className: 'text-sky-400 font-bold' },
      { pattern: /\b(?:console|document|window|Array|Object|String|Number|Boolean|Map|Set|Promise|JSON|Math|Date)\b/y, className: 'text-teal-300 font-semibold' },
      { pattern: /[=+\-*/%&|!<>?:;.,{}()[\]]+/y, className: 'text-zinc-400' },
      { pattern: /[a-zA-Z_$][a-zA-Z0-9_$]*/y, className: 'text-zinc-100' },
      { pattern: /\s+/y },
      { pattern: /./y },
    ];
  }

  if (normalized === 'python' || normalized === 'py') {
    return [
      { pattern: /#[^\n]*/y, className: 'text-zinc-500 italic' },
      { pattern: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, className: 'text-emerald-300' },
      { pattern: /\b\d+(?:\.\d+)?\b/y, className: 'text-purple-400 font-semibold' },
      { pattern: /\b(?:def|return|if|elif|else|while|for|in|range|break|continue|pass|class|import|from|as|try|except|finally|raise|with|lambda|yield|global|nonlocal|assert|del|True|False|None|and|or|not|is)\b/y, className: 'text-sky-400 font-bold' },
      { pattern: /\b(?:print|len|input|int|str|float|list|dict|set|tuple|type|open|sum|min|max)\b/y, className: 'text-teal-300 font-semibold' },
      { pattern: /\bself\b/y, className: 'text-amber-300 font-medium' },
      { pattern: /[=+\-*/%&|!<>?:;.,{}()[\]]+/y, className: 'text-zinc-400' },
      { pattern: /[a-zA-Z_][a-zA-Z0-9_]*/y, className: 'text-zinc-100' },
      { pattern: /\s+/y },
      { pattern: /./y },
    ];
  }

  if (normalized === 'css') {
    return [
      { pattern: /\/\*[\s\S]*?\*\//y, className: 'text-zinc-500 italic' },
      { pattern: /[.#][a-zA-Z0-9_-]+/y, className: 'text-amber-300 font-bold' },
      { pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, className: 'text-emerald-300' },
      { pattern: /#[0-9a-fA-F]{3,8}\b/y, className: 'text-purple-400 font-semibold' },
      { pattern: /\b\d+(?:px|rem|em|%|vh|vw|s|ms|deg)?\b/y, className: 'text-purple-400' },
      { pattern: /[a-zA-Z0-9_-]+(?=\s*:)/y, className: 'text-sky-300' },
      { pattern: /[{}:;,]/y, className: 'text-zinc-400' },
      { pattern: /\s+/y },
      { pattern: /./y },
    ];
  }

  if (normalized === 'java' || normalized === 'c' || normalized === 'cpp' || normalized === 'csharp' || normalized === 'cs') {
    return [
      { pattern: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y, className: 'text-zinc-500 italic' },
      { pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, className: 'text-emerald-300' },
      { pattern: /\b\d+(?:\.\d+)?(?:[fFlLuU])?\b/y, className: 'text-purple-400 font-semibold' },
      { pattern: /\b(?:public|private|protected|static|void|int|float|double|char|boolean|bool|long|short|byte|string|String|class|interface|struct|enum|extends|implements|return|if|else|for|while|do|switch|case|break|continue|default|new|this|super|try|catch|finally|throw|throws|import|package|include|using|namespace|true|false|null)\b/y, className: 'text-sky-400 font-bold' },
      { pattern: /[=+\-*/%&|!<>?:;.,{}()[\]]+/y, className: 'text-zinc-400' },
      { pattern: /[a-zA-Z_][a-zA-Z0-9_]*/y, className: 'text-zinc-100' },
      { pattern: /\s+/y },
      { pattern: /./y },
    ];
  }

  if (normalized === 'json') {
    return [
      { pattern: /"(?:\\.|[^"\\])*"(?=\s*:)/y, className: 'text-amber-300 font-medium' },
      { pattern: /"(?:\\.|[^"\\])*"/y, className: 'text-emerald-300' },
      { pattern: /\b\d+(?:\.\d+)?\b/y, className: 'text-purple-400 font-semibold' },
      { pattern: /\b(?:true|false|null)\b/y, className: 'text-sky-400 font-bold' },
      { pattern: /[{}[\]:,]/y, className: 'text-zinc-400' },
      { pattern: /\s+/y },
      { pattern: /./y },
    ];
  }

  // Default fallback
  return [
    { pattern: /\/\/[^\n]*|#[^\n]*/y, className: 'text-zinc-500 italic' },
    { pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, className: 'text-emerald-300' },
    { pattern: /\b\d+(?:\.\d+)?\b/y, className: 'text-purple-400' },
    { pattern: /\s+/y },
    { pattern: /./y },
  ];
};

const tokenizeLine = (line: string, rules: TokenRule[]): React.ReactNode[] => {
  const elements: React.ReactNode[] = [];
  let index = 0;
  const len = line.length;
  const blankRegex = /_{2,}\((\d+)\)_{2,}/y;

  while (index < len) {
    // Check if current position is a fill-in blank e.g. ____(1)____
    blankRegex.lastIndex = index;
    const blankMatch = blankRegex.exec(line);
    if (blankMatch && blankMatch.index === index) {
      const fullText = blankMatch[0];
      const blankNum = blankMatch[1];
      index += fullText.length;
      elements.push(
        <span
          key={`blank_${elements.length}`}
          className="inline-flex items-center px-1.5 py-0.2 mx-0.5 rounded-sm bg-amber-400/20 text-amber-300 border border-amber-400/60 font-mono font-bold text-[11px] shadow-xs select-none"
          title={`Slot Isian #${blankNum}`}
        >
          <span className="text-amber-400 font-extrabold mr-0.5">({blankNum})</span>
          <span className="tracking-widest opacity-80">____</span>
        </span>
      );
      continue;
    }

    let matched = false;

    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r];
      rule.pattern.lastIndex = index;
      const match = rule.pattern.exec(line);

      if (match && match.index === index && match[0].length > 0) {
        const text = match[0];
        index += text.length;
        if (rule.className) {
          elements.push(
            <span key={elements.length} className={rule.className}>
              {text}
            </span>
          );
        } else {
          elements.push(text);
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      elements.push(line[index]);
      index++;
    }
  }

  return elements;
};

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = 'text' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = useMemo(() => {
    const normalized = (code || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
    return normalized ? normalized.split('\n') : [''];
  }, [code]);

  const rules = useMemo(() => getLanguageRules(language), [language]);

  return (
    <div className="my-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 font-mono text-xs overflow-hidden shadow-md">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-950 border-b border-zinc-800 text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-emerald-400">
          <Code className="w-3.5 h-3.5" />
          {language}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-bold">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3 overflow-x-auto leading-relaxed">
        <div className="table w-full">
          {lines.map((line, idx) => (
            <div key={idx} className="table-row">
              <span className="table-cell pr-4 text-zinc-600 select-none text-right w-8 tabular-nums">
                {idx + 1}
              </span>
              <span className="table-cell whitespace-pre font-mono">
                {line.length > 0 ? tokenizeLine(line, rules) : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface FormattedTextProps {
  text: string;
  className?: string;
}

export const FormattedText: React.FC<FormattedTextProps> = ({ text, className = '' }) => {
  if (!text) return null;

  // Regex to split text by markdown code blocks ```lang ... ```
  // Handles Windows/Linux linebreaks and optional spaces after language name
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)[ \t]*(?:\r?\n| )([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const renderInlineContent = (content: string, baseKey: string | number) => {
    // Match inline code `...` OR blank placeholders ____(N)____
    const inlineRegex = /(`[^`\n]+`)|(_{2,}\(\d+\)_{2,})/g;
    const inlineParts: React.ReactNode[] = [];
    let inlineLastIndex = 0;
    let inlineMatch: RegExpExecArray | null;

    while ((inlineMatch = inlineRegex.exec(content)) !== null) {
      if (inlineMatch.index > inlineLastIndex) {
        inlineParts.push(content.substring(inlineLastIndex, inlineMatch.index));
      }

      if (inlineMatch[1]) {
        const codeText = inlineMatch[1].slice(1, -1);
        inlineParts.push(
          <code
            key={`inline_${baseKey}_${inlineMatch.index}`}
            className="px-1.5 py-0.5 mx-0.5 rounded-md bg-slate-100 dark:bg-zinc-800 text-amber-700 dark:text-amber-300 font-mono text-xs border border-slate-200 dark:border-zinc-700 font-semibold"
          >
            {codeText}
          </code>
        );
      } else if (inlineMatch[2]) {
        const numMatch = inlineMatch[2].match(/\((\d+)\)/);
        const blankNum = numMatch ? numMatch[1] : '?';
        inlineParts.push(
          <span
            key={`blank_inline_${baseKey}_${inlineMatch.index}`}
            className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-mono font-bold text-xs shadow-2xs"
          >
            <span className="text-amber-600 dark:text-amber-400 font-black mr-0.5">({blankNum})</span>
            <span className="tracking-widest opacity-75">____</span>
          </span>
        );
      }

      inlineLastIndex = inlineMatch.index + inlineMatch[0].length;
    }

    if (inlineLastIndex < content.length) {
      inlineParts.push(content.substring(inlineLastIndex));
    }

    return inlineParts;
  };

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const normalText = text.substring(lastIndex, match.index);
      parts.push(
        <span key={`text_${lastIndex}`} className="whitespace-pre-line">
          {renderInlineContent(normalText, `t_${lastIndex}`)}
        </span>
      );
    }

    const lang = match[1] || 'code';
    const codeContent = match[2];

    parts.push(
      <CodeBlock key={`code_${match.index}`} language={lang} code={codeContent} />
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const normalText = text.substring(lastIndex);
    parts.push(
      <span key={`text_${lastIndex}`} className="whitespace-pre-line">
        {renderInlineContent(normalText, `t_${lastIndex}`)}
      </span>
    );
  }

  return <div className={className}>{parts}</div>;
};
