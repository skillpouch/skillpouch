// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '.engram/**'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: { globals: { ...globals.node } },
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			'@typescript-eslint/consistent-type-imports': 'error',
		},
	},
	{
		// The web app runs in the browser and follows the rules of hooks.
		files: ['apps/web/**/*.{ts,tsx}'],
		languageOptions: { globals: { ...globals.browser } },
		plugins: { 'react-hooks': reactHooks },
		rules: {
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'error',
		},
	},
	{
		// Tests read loosely typed JSON response bodies.
		files: ['**/test/**/*.ts'],
		rules: { '@typescript-eslint/no-explicit-any': 'off' },
	},
	{
		// Errors are raised only through AppError with a registry code.
		files: ['apps/api/src/modules/**/*.ts', 'apps/api/src/security/**/*.ts'],
		ignores: ['**/*.test.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: "ThrowStatement > NewExpression[callee.name='Error']",
					message:
						'Throw AppError(code, details) with a code from @skillpouch/contracts.',
				},
			],
		},
	},
);
