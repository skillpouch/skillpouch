// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/llms.txt` (https://llmstxt.org): what SkillPouch is, for AI tools, built
 * from the landing page's own copy so the two can't disagree.
 */
import {
	ASSISTANTS,
	CLI_RELEASES_URL,
	CLI_SOURCE_URL,
	DISCORD_URL,
	FAQS,
	INSTALL_COMMAND,
	NPM_URL,
	SOURCE_URL,
} from '@/components/landing-content';
import { DOCS_URL, PLANS_URL, SIGN_IN_URL } from '@/lib/links';

export function llmsTxt(): string {
	return [
		'# SkillPouch',
		'',
		'> Your AI coding setup, on every computer. SkillPouch syncs skills, agents, commands, MCP servers, hooks, plugins, settings and instructions across every computer and every assistant, end-to-end encrypted. Open source (AGPL) and self-hostable.',
		'',
		`Install the CLI with \`${INSTALL_COMMAND}\`, run \`skillpouch login\`, and approve the computer in the browser. A background sync keeps every computer up to date, and each assistant gets items in its own format and folder:`,
		'',
		...ASSISTANTS.map((assistant) => `- ${assistant.name}: \`${assistant.path}\``),
		'',
		...FAQS.flatMap((faq) => [`**${faq.question}** ${faq.answer}`, '']),
		'## About',
		'',
		'- [About SkillPouch](https://skillpouch.net/about/): what it is, who it is for, how it works, project facts',
		'- [FAQ](https://skillpouch.net/faq/): every question above, with links to the docs',
		'- [Ways to sync your AI coding setup](https://skillpouch.net/compare/): copying by hand, a dotfiles repository and SkillPouch compared',
		'',
		'## Docs',
		'',
		`- [Documentation for AI tools](${DOCS_URL}/llms.txt): the docs as plain text`,
		`- [Full documentation for AI tools](${DOCS_URL}/llms-full.txt): every guide in one file`,
		`- [How SkillPouch works](${DOCS_URL}/getting-started/overview/): pouches, the CLI, the web app and encryption`,
		`- [Install](${DOCS_URL}/getting-started/install/): install the CLI and connect a first computer`,
		`- [Supported assistants](${DOCS_URL}/assistants/): what syncs where in each assistant`,
		`- [Security](${DOCS_URL}/security/): how the end-to-end encryption works`,
		`- [Self-hosting](${DOCS_URL}/self-hosting/): run your own server`,
		'',
		'## Optional',
		'',
		`- [Web app](${SIGN_IN_URL}): sign in with GitHub or Google`,
		`- [Plans](${PLANS_URL}): current pricing as JSON; every plan has every feature`,
		`- [Source code](${SOURCE_URL}): server, web app and docs (AGPL-3.0)`,
		`- [CLI source code](${CLI_SOURCE_URL}): the \`skillpouch\` command-line tool, in Rust (AGPL-3.0)`,
		`- [CLI releases](${CLI_RELEASES_URL}): release notes and changelog`,
		`- [npm package](${NPM_URL})`,
		`- [Discord](${DISCORD_URL})`,
		'',
	].join('\n');
}
