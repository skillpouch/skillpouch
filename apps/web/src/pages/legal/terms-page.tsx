// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { ContactLink, LegalLayout, LegalList, LegalSection } from './legal-layout';

export function TermsPage() {
	return (
		<LegalLayout title="Terms of Service">
			<p>
				These terms apply when you use SkillPouch at skillpouch.net, its command-line tool
				and its API. By creating an account you agree to them.
			</p>

			<LegalSection title="Your account">
				<p>
					You sign in with GitHub or Google and are responsible for everything done with
					your account. Keep your master password and Recovery Key safe: your data is
					end-to-end encrypted, so if you lose both and have no other trusted device or
					browser, nobody, including us, can recover it.
				</p>
			</LegalSection>

			<LegalSection title="Your content">
				<p>
					You keep all rights to what you sync. You give us only the permission needed to
					store and deliver it, in encrypted form, to your devices and to the people you
					share it with. You are responsible for having the right to sync and share it.
				</p>
			</LegalSection>

			<LegalSection title="Acceptable use">
				<p>Do not use SkillPouch to:</p>
				<LegalList
					items={[
						'store or share anything illegal, or malware;',
						'infringe others’ rights;',
						'attack, overload or try to break into the service or other accounts;',
						'get around plan limits or resell the service without our permission.',
					]}
				/>
				<p>We may suspend accounts that break these rules.</p>
			</LegalSection>

			<LegalSection title="Plans and payments">
				<p>
					The Free plan costs nothing. Paid plans are sold through Polar, our merchant of
					record, which handles payment, taxes and invoices. You can cancel at any time;
					your plan stays active until the end of the paid period. If you move to a
					smaller plan, nothing is deleted: anything above the new limits becomes
					read-only.
				</p>
			</LegalSection>

			<LegalSection title="Availability">
				<p>
					We work to keep SkillPouch available and your data safe, but the service is
					provided “as is”, without warranties. Your devices keep their own copies of your
					files; keep backups of anything important.
				</p>
			</LegalSection>

			<LegalSection title="Liability">
				<p>
					To the extent the law allows, we are not liable for indirect or consequential
					losses, or for loss of data. Our total liability is limited to the amount you
					paid us in the 12 months before the claim.
				</p>
			</LegalSection>

			<LegalSection title="Ending your account">
				<p>
					You can delete your account at any time in your account settings. We may end or
					suspend accounts that break these terms, and will tell you why when we can.
				</p>
			</LegalSection>

			<LegalSection title="Privacy">
				<p>
					How we handle personal data is described in the{' '}
					<Link className="text-fg underline hover:text-accent-text" to="/privacy">
						Privacy Policy
					</Link>
					.
				</p>
			</LegalSection>

			<LegalSection title="Changes">
				<p>
					We may update these terms. For significant changes we notify you before they
					take effect; using SkillPouch afterwards means you accept them.
				</p>
			</LegalSection>

			<LegalSection title="Contact">
				<p>
					Questions about these terms: <ContactLink />.
				</p>
			</LegalSection>
		</LegalLayout>
	);
}
