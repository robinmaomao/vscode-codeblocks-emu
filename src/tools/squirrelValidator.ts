/**
 * Squirrel 语法校验器（只校验语法，不执行脚本）。
 *
 * 依据 Code::Blocks 随包的 Squirrel 3.x 词法/语法：
 * - 词法移植自 `codeblocks-src/src/sdk/scripting/squirrel/sqlexer.cpp`
 * - 语句/表达式结构对照 `sqcompiler.cpp`（函数、local、class、enum、table/array、
 *   if/while/do/for/foreach/switch/try/catch/throw/return/yield 等）
 *
 * 说明：这里做的是**语法**校验，不解析 Code::Blocks 绑定的运行时 API；
 * 脚本中的标识符/成员是否存在不在校验范围内。
 */

export interface SquirrelSyntaxError {
  line: number;
  column: number;
  message: string;
}

type TokenType = 'ident' | 'number' | 'string' | 'op' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const MULTI_OPS = [
  '>>>=', '<<=', '>>=', '>>>', '...', '<=>', '===', '!==',
  '==', '!=', '<=', '>=', '&&', '||', '??', '<-', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::', '=>', '?.', '..',
];

const BINARY_PRECEDENCE: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '|': 4,
  '^': 5,
  '&': 6,
  '==': 7, '!=': 7, '===': 7, '!==': 7,
  '<': 8, '>': 8, '<=': 8, '>=': 8, '<=>': 8, 'in': 8, 'instanceof': 8,
  '<<': 9, '>>': 9, '>>>': 9,
  '+': 10, '-': 10,
  '*': 11, '/': 11, '%': 11,
};

const ASSIGN_OPS = new Set(['=', '<-', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=']);

const KEYWORDS = new Set([
  'if', 'else', 'while', 'do', 'for', 'foreach', 'in', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'yield', 'local', 'function', 'class', 'extends',
  'constructor', 'static', 'enum', 'const', 'try', 'catch', 'throw', 'typeof',
  'clone', 'delete', 'resume', 'this', 'base', 'null', 'true', 'false',
  'instanceof',
]);

export class SquirrelLexer {
  private i = 0;
  private line = 1;
  private column = 1;
  private readonly tokens: Token[] = [];
  private error: SquirrelSyntaxError | undefined;

  constructor(private readonly src: string) {}

  tokenize(): { tokens: Token[]; error?: SquirrelSyntaxError } {
    while (this.i < this.src.length && !this.error) {
      const ch = this.src[this.i];
      if (ch === '\n') { this.i++; this.line++; this.column = 1; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { this.i++; this.column++; continue; }
      if (ch === '/' && this.src[this.i + 1] === '/') { this.skipLineComment(); continue; }
      if (ch === '/' && this.src[this.i + 1] === '*') { this.skipBlockComment(); continue; }
      if (ch === '"' || ch === "'") { this.readString(ch); continue; }
      if (ch === '@' && this.src[this.i + 1] === '"') { this.readVerbatimString(); continue; }
      if (isDigit(ch) || (ch === '.' && isDigit(this.src[this.i + 1]))) { this.readNumber(); continue; }
      if (isIdentStart(ch)) { this.readIdent(); continue; }
      this.readOperator();
    }
    this.tokens.push({ type: 'eof', value: '', line: this.line, column: this.column });
    return { tokens: this.tokens, error: this.error };
  }

  private skipLineComment(): void {
    while (this.i < this.src.length && this.src[this.i] !== '\n') { this.i++; this.column++; }
  }

  private skipBlockComment(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.i += 2; this.column += 2;
    let depth = 1;
    while (this.i < this.src.length && depth > 0) {
      const ch = this.src[this.i];
      if (ch === '/' && this.src[this.i + 1] === '*') { depth++; this.i += 2; this.column += 2; continue; }
      if (ch === '*' && this.src[this.i + 1] === '/') { depth--; this.i += 2; this.column += 2; continue; }
      if (ch === '\n') { this.i++; this.line++; this.column = 1; continue; }
      this.i++; this.column++;
    }
    if (depth > 0) this.error = { line: startLine, column: startCol, message: 'Unterminated block comment' };
  }

  private readString(quote: string): void {
    const startLine = this.line;
    const startCol = this.column;
    this.i++; this.column++;
    let value = '';
    while (this.i < this.src.length) {
      const ch = this.src[this.i];
      if (ch === '\\') {
        const next = this.src[this.i + 1];
        value += ch + (next ?? '');
        this.i += 2; this.column += 2;
        continue;
      }
      if (ch === quote) {
        this.i++; this.column++;
        this.tokens.push({ type: 'string', value, line: startLine, column: startCol });
        return;
      }
      if (ch === '\n') break;
      value += ch; this.i++; this.column++;
    }
    this.error = { line: startLine, column: startCol, message: 'Unterminated string literal' };
  }

  private readVerbatimString(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.i += 2; this.column += 2;
    let value = '';
    while (this.i < this.src.length) {
      const ch = this.src[this.i];
      if (ch === '"' && this.src[this.i + 1] === '"') { value += '"'; this.i += 2; this.column += 2; continue; }
      if (ch === '"') {
        this.i++; this.column++;
        this.tokens.push({ type: 'string', value, line: startLine, column: startCol });
        return;
      }
      if (ch === '\n') { value += ch; this.i++; this.line++; this.column = 1; continue; }
      value += ch; this.i++; this.column++;
    }
    this.error = { line: startLine, column: startCol, message: 'Unterminated verbatim string literal' };
  }

  private readNumber(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = '';
    if (this.src[this.i] === '0' && /[xX]/.test(this.src[this.i + 1] ?? '')) {
      value += this.src[this.i++]; value += this.src[this.i++];
      while (this.i < this.src.length && /[0-9a-fA-F]/.test(this.src[this.i])) { value += this.src[this.i++]; }
    } else if (this.src[this.i] === '0' && /[bB]/.test(this.src[this.i + 1] ?? '')) {
      value += this.src[this.i++]; value += this.src[this.i++];
      while (this.i < this.src.length && /[01]/.test(this.src[this.i])) { value += this.src[this.i++]; }
    } else {
      while (this.i < this.src.length && /[0-9]/.test(this.src[this.i])) { value += this.src[this.i++]; }
      if (this.src[this.i] === '.') { value += this.src[this.i++]; while (this.i < this.src.length && /[0-9]/.test(this.src[this.i])) { value += this.src[this.i++]; } }
      if (/[eE]/.test(this.src[this.i] ?? '')) {
        value += this.src[this.i++];
        if (/[+-]/.test(this.src[this.i] ?? '')) value += this.src[this.i++];
        while (this.i < this.src.length && /[0-9]/.test(this.src[this.i])) { value += this.src[this.i++]; }
      }
    }
    this.column += value.length;
    this.tokens.push({ type: 'number', value, line: startLine, column: startCol });
  }

  private readIdent(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = '';
    while (this.i < this.src.length && isIdentPart(this.src[this.i])) { value += this.src[this.i++]; }
    this.column += value.length;
    this.tokens.push({ type: 'ident', value, line: startLine, column: startCol });
  }

  private readOperator(): void {
    const startLine = this.line;
    const startCol = this.column;
    for (const op of MULTI_OPS) {
      if (this.src.startsWith(op, this.i)) {
        this.i += op.length; this.column += op.length;
        this.tokens.push({ type: 'op', value: op, line: startLine, column: startCol });
        return;
      }
    }
    const ch = this.src[this.i++];
    this.column++;
    this.tokens.push({ type: 'op', value: ch, line: startLine, column: startCol });
  }
}

function isDigit(ch: string | undefined): boolean { return !!ch && ch >= '0' && ch <= '9'; }
function isIdentStart(ch: string | undefined): boolean { return !!ch && /[A-Za-z_]/.test(ch); }
function isIdentPart(ch: string | undefined): boolean { return !!ch && /[A-Za-z0-9_]/.test(ch); }

class Parser {
  private pos = 0;
  private error: SquirrelSyntaxError | undefined;

  constructor(private readonly tokens: Token[]) {}

  parse(): SquirrelSyntaxError | undefined {
    while (!this.error && !this.at('eof')) {
      this.parseStatement();
    }
    return this.error;
  }

  private peek(offset = 0): Token { return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]; }
  private at(value: string): boolean { return this.peek().value === value || this.peek().type === value; }
  private atKeyword(...values: string[]): boolean { return this.peek().type === 'ident' && values.includes(this.peek().value); }
  private advance(): Token { const t = this.peek(); if (t.type !== 'eof') this.pos++; return t; }
  private fail(token: Token, message: string): void {
    if (!this.error) this.error = { line: token.line, column: token.column, message };
  }
  private expect(value: string, message?: string): Token {
    const t = this.peek();
    if (t.value === value) return this.advance();
    this.fail(t, message ?? `Expected '${value}' but found '${t.value || t.type}'`);
    return t;
  }
  private expectIdent(message = 'Expected an identifier'): Token {
    const t = this.peek();
    if (t.type === 'ident' && !KEYWORDS.has(t.value)) return this.advance();
    this.fail(t, message);
    return t;
  }
  private expectName(message = 'Expected an identifier'): Token {
    const t = this.peek();
    if (t.type === 'ident') return this.advance();
    this.fail(t, message);
    return t;
  }
  private consumeOptional(value: string): boolean {
    if (this.peek().value === value) { this.advance(); return true; }
    return false;
  }

  private parseStatement(): void {
    const t = this.peek();
    if (t.type === 'eof' || t.value === '}') return;
    if (this.consumeOptional(';')) return;
    if (t.value === '{') { this.parseBlock(); return; }
    if (t.type === 'ident') {
      switch (t.value) {
        case 'if': this.advance(); this.expect('('); this.parseExpression(); this.expect(')'); this.parseStatement(); if (this.atKeyword('else')) { this.advance(); this.parseStatement(); } return;
        case 'while': this.advance(); this.expect('('); this.parseExpression(); this.expect(')'); this.parseStatement(); return;
        case 'do': this.advance(); this.parseStatement(); this.expect('while'); this.expect('('); this.parseExpression(); this.expect(')'); this.consumeOptional(';'); return;
        case 'for': this.parseFor(); return;
        case 'foreach': this.parseForeach(); return;
        case 'switch': this.parseSwitch(); return;
        case 'try': this.parseTry(); return;
        case 'throw': this.advance(); this.parseExpression(); this.consumeOptional(';'); return;
        case 'return': case 'yield': this.advance(); if (!this.at(';') && !this.at('}') && !this.at('eof')) this.parseExpression(); this.consumeOptional(';'); return;
        case 'break': case 'continue': this.advance(); this.consumeOptional(';'); return;
        case 'local': this.parseLocal(); return;
        case 'function': this.parseFunctionDeclaration(); return;
        case 'class': this.parseClassDeclaration(); return;
        case 'enum': this.parseEnum(); return;
        case 'const': this.advance(); this.expectIdent(); this.expect('='); this.parseExpression(); this.consumeOptional(';'); return;
        case 'case': this.advance(); this.parseExpression(); this.expect(':'); return;
        case 'default': this.advance(); this.expect(':'); return;
        default: break;
      }
    }
    if (t.value === '[' && this.peek(1).value === '[') { // attribute block: [[...]]
      this.parseAttributes();
      return;
    }
    this.parseExpression();
    this.consumeOptional(';');
  }

  private parseAttributes(): void {
    this.expect('['); this.expect('[');
    let depth = 0;
    while (!this.at('eof')) {
      const v = this.advance().value;
      if (v === '[') depth++;
      else if (v === ']') { if (depth === 0) { this.consumeOptional(']'); return; } depth--; }
    }
  }

  private parseBlock(): void {
    this.expect('{');
    while (!this.error && !this.at('}') && !this.at('eof')) this.parseStatement();
    this.expect('}');
  }

  private parseFor(): void {
    this.advance(); this.expect('(');
    if (!this.at(';')) {
      if (this.atKeyword('local')) this.parseLocal(false); else this.parseExpression();
    }
    this.expect(';');
    if (!this.at(';')) this.parseExpression();
    this.expect(';');
    if (!this.at(')')) this.parseExpression();
    this.expect(')');
    this.parseStatement();
  }

  private parseForeach(): void {
    this.advance(); this.expect('(');
    this.expectIdent();
    if (this.consumeOptional(',')) this.expectIdent();
    this.expect('in');
    this.parseExpression();
    this.expect(')');
    this.parseStatement();
  }

  private parseSwitch(): void {
    this.advance(); this.expect('('); this.parseExpression(); this.expect(')'); this.expect('{');
    while (!this.error && !this.at('}') && !this.at('eof')) {
      if (this.atKeyword('case')) { this.advance(); this.parseExpression(); this.expect(':'); }
      else if (this.atKeyword('default')) { this.advance(); this.expect(':'); }
      else this.parseStatement();
    }
    this.expect('}');
  }

  private parseTry(): void {
    this.advance(); this.parseBlock();
    if (!this.atKeyword('catch')) { this.fail(this.peek(), 'Expected catch after try block'); return; }
    this.advance(); this.expect('('); this.expectIdent(); this.expect(')'); this.parseBlock();
  }

  private parseLocal(withSemicolon = true): void {
    this.advance();
    if (this.atKeyword('function')) { this.parseFunctionDeclaration(); return; }
    do {
      this.expectIdent();
      if (this.consumeOptional('=')) this.parseExpression();
    } while (this.consumeOptional(','));
    if (withSemicolon) this.consumeOptional(';');
  }

  private parseFunctionDeclaration(): void {
    this.advance(); // function
    this.expectIdent();
    if (this.consumeOptional('::')) this.expectIdent();
    this.parseParameterList();
    this.parseBlock();
  }

  private parseParameterList(): void {
    this.expect('(');
    while (!this.error && !this.at(')') && !this.at('eof')) {
      if (this.consumeOptional('...')) break;
      this.expectIdent();
      if (this.consumeOptional('=')) this.parseExpression();
      if (!this.consumeOptional(',')) break;
    }
    this.expect(')');
  }

  private parseClassDeclaration(): void {
    this.advance(); this.expectIdent();
    if (this.consumeOptional('extends')) this.parseExpression();
    this.parseClassBody();
  }

  private parseClassBody(): void {
    this.expect('{');
    while (!this.error && !this.at('}') && !this.at('eof')) {
      if (this.consumeOptional(';')) continue;
      if (this.at('[') && this.peek(1).value === '[') { this.parseAttributes(); continue; }
      this.consumeOptional('static');
      if (this.atKeyword('constructor')) { this.advance(); this.parseParameterList(); this.parseBlock(); continue; }
      if (this.atKeyword('function')) { this.advance(); this.expectIdent(); this.parseParameterList(); this.parseBlock(); continue; }
      this.expectIdent();
      if (this.consumeOptional('=')) this.parseExpression();
      this.consumeOptional(';');
    }
    this.expect('}');
  }

  private parseEnum(): void {
    this.advance(); this.expectIdent(); this.expect('{');
    while (!this.error && !this.at('}') && !this.at('eof')) {
      this.expectIdent();
      if (this.consumeOptional('=')) this.parseExpression();
      if (!this.consumeOptional(',')) break;
    }
    this.expect('}');
  }

  private parseExpression(precedence = 0): void {
    if (this.error) return;
    this.parseUnary();
    while (!this.error) {
      const t = this.peek();
      if (t.type === 'op' && t.value === '?') {
        if (precedence > 1) break;
        this.advance();
        this.parseExpression(0);
        this.expect(':');
        this.parseExpression(1);
        continue;
      }
      if (t.type === 'op' && ASSIGN_OPS.has(t.value)) {
        if (precedence > 0) break;
        this.advance();
        this.parseExpression(0);
        continue;
      }
      const prec = t.type === 'ident' || t.type === 'op' ? BINARY_PRECEDENCE[t.value] : undefined;
      if (!prec || prec <= precedence) break;
      this.advance();
      this.parseExpression(prec);
    }
  }

  private parseUnary(): void {
    const t = this.peek();
    const isOp = t.type === 'op' && (t.value === '!' || t.value === '-' || t.value === '+' || t.value === '~' || t.value === '++' || t.value === '--');
    if (isOp || (t.type === 'ident' && ['typeof', 'clone', 'delete', 'resume'].includes(t.value))) {
      this.advance();
      this.parseUnary();
      return;
    }
    this.parsePostfix();
  }

  private parsePostfix(): void {
    this.parsePrimary();
    while (!this.error) {
      const t = this.peek();
      if (t.value === '(') { this.parseCallArgs(); continue; }
      if (t.value === '[') { this.advance(); this.parseExpression(); this.expect(']'); continue; }
      if (t.value === '.' || t.value === '?.' || t.value === '::') { this.advance(); this.expectName(); continue; }
      if (t.type === 'op' && (t.value === '++' || t.value === '--')) { this.advance(); continue; }
      break;
    }
  }

  private parseCallArgs(): void {
    this.expect('(');
    while (!this.error && !this.at(')') && !this.at('eof')) {
      this.parseExpression();
      if (!this.consumeOptional(',')) break;
    }
    this.expect(')');
  }

  private parsePrimary(): void {
    const t = this.peek();
    if (t.type === 'number' || t.type === 'string') { this.advance(); return; }
    if (t.value === '...') { this.advance(); return; }
    if (t.value === '::') { this.advance(); this.expectName(); return; }
    if (t.type === 'ident') {
      if (t.value === 'function') { this.advance(); if (this.peek().type === 'ident' && this.peek().value !== '(') this.expectIdent(); this.parseParameterList(); this.parseBlock(); return; }
      if (t.value === 'class') { this.advance(); if (this.peek().type === 'ident') this.expectIdent(); if (this.consumeOptional('extends')) this.parseExpression(); this.parseClassBody(); return; }
      if (t.value === 'null' || t.value === 'true' || t.value === 'false' || t.value === 'this' || t.value === 'base') { this.advance(); return; }
      this.advance();
      return;
    }
    if (t.value === '(') { this.advance(); this.parseExpression(); this.expect(')'); return; }
    if (t.value === '[') { this.parseArrayLiteral(); return; }
    if (t.value === '{') { this.parseTableLiteral(); return; }
    if (t.value === '@') { this.advance(); this.parseParameterList(); this.parseExpression(); return; }
    this.fail(t, `Unexpected token '${t.value || t.type}'`);
  }

  private parseArrayLiteral(): void {
    this.expect('[');
    while (!this.error && !this.at(']') && !this.at('eof')) {
      this.parseExpression();
      if (!this.consumeOptional(',')) break;
    }
    this.expect(']');
  }

  private parseTableLiteral(): void {
    this.expect('{');
    while (!this.error && !this.at('}') && !this.at('eof')) {
      if (this.consumeOptional(',')) continue;
      if (this.consumeOptional(';')) continue;
      if (this.at('[')) {
        this.advance(); this.parseExpression(); this.expect(']');
      } else if (this.peek().type === 'string' || this.peek().type === 'ident') {
        this.advance();
      } else {
        this.fail(this.peek(), 'Expected a table key');
        return;
      }
      if (this.consumeOptional('=')) this.parseExpression();
      else if (this.consumeOptional('<-')) this.parseExpression();
      else { this.fail(this.peek(), 'Expected = after table key'); return; }
    }
    this.expect('}');
  }
}

/** 校验脚本语法；返回第一处错误（无错误返回 undefined） */
export function validateSquirrelSyntax(source: string): SquirrelSyntaxError | undefined {
  const lexed = new SquirrelLexer(source).tokenize();
  if (lexed.error) return lexed.error;
  return new Parser(lexed.tokens).parse();
}
