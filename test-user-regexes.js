// 验证 L1：default.conf 用户自定义错误正则的解析与按索引覆盖/追加（对齐 Compiler::LoadSettings:699-737）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CodeBlocksConfig } = require('./dist/compiler/codeblocksConfig.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-regex-'));
const conf = path.join(dir, 'default.conf');
fs.writeFileSync(conf, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocksConfig>
	<compiler>
		<compiler_sets>
			<tst>
				<regex>
					<re001>
						<description><str><![CDATA[user error]]></str></description>
						<type int="2" />
						<regex><str><![CDATA[USERERR:([[:blank:]]*.*)]]></str></regex>
						<msg1 int="1" />
					</re001>
					<re005>
						<description><str><![CDATA[user extra]]></str></description>
						<type int="1" />
						<regex><str><![CDATA[USERWARN]]></str></regex>
						<msg1 int="1" />
					</re005>
					<re002>
						<type int="2" />
						<regex><str><![CDATA[NODESC]]></str></regex>
					</re002>
				</regex>
			</tst>
		</compiler_sets>
	</compiler>
</CodeBlocksConfig>`, 'utf-8');

const cfg = new CodeBlocksConfig();
cfg.load(conf);

const base = [
  { desc: 'x1', lt: 'normal', msg: [0, 0, 0], filename: 0, line: 0, regex: 'X1' },
];
cfg.applyUserRegexes('tst', base);

// 索引 1 覆盖 base[0]
check('索引 1 覆盖', base[0].desc === 'user error' && base[0].lt === 'error');
// POSIX [:blank:] 转换
check('POSIX [:blank:] 转换', base[0].regex.includes(' \\t'));
check('msg 子表达式', base[0].msg[0] === 1);
// 索引 5 > 现有数 → 追加（现有 1 条）
check('索引 5 追加', base.length === 2 && base[1].desc === 'user extra' && base[1].lt === 'warning');
// 无 description 的 re002 跳过（对齐 CB）
check('无 description 跳过', base.length === 2);
// 未知编译器 ID 不生效
const untouched = [{ desc: 'k', lt: 'normal', msg: [0, 0, 0], filename: 0, line: 0, regex: 'K' }];
cfg.applyUserRegexes('nonexist', untouched);
check('未知 ID 不生效', untouched.length === 1 && untouched[0].desc === 'k');

fs.rmSync(dir, { recursive: true, force: true });
console.log('汇总: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
