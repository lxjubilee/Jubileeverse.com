'use client';

import Modal from '@/components/ui/Modal';
import styles from '@/app/(auth)/auth.module.css';

interface Props {
  privacyOpen: boolean;
  termsOpen: boolean;
  onClose: () => void;
}

/** Privacy Policy + Terms of Use modals shared by the auth pages. */
export default function LegalModals({ privacyOpen, termsOpen, onClose }: Props) {
  return (
    <>
      <Modal open={privacyOpen} title="Privacy Policy" onClose={onClose}>
        <div className={styles.legalBody}>
          <h1>Jubilee Privacy Policy</h1>
          <p>
            <strong>Effective Date:</strong> January 1, 2026
          </p>
          <p>
            Jubilee Enterprise LLC respects your privacy and is committed to protecting the personal
            information you share with us.
          </p>
          <h2>Contact Us</h2>
          <p>
            <strong>Jubilee Enterprise LLC</strong>
          </p>
          <p>
            Email: <a href="mailto:support@jubileeverse.com">support@jubileeverse.com</a>
          </p>
        </div>
      </Modal>

      <Modal open={termsOpen} title="Terms of Use" onClose={onClose}>
        <div className={styles.legalBody}>
          <h1>Terms of Use (EULA)</h1>
          <p>
            These Terms of Use govern your access to and use of the JubileeVerse website and services
            provided by Jubilee Enterprise LLC.
          </p>
          <h2>Contact Us</h2>
          <p>
            <strong>Jubilee Enterprise LLC</strong>
          </p>
          <p>
            Email: <a href="mailto:support@jubileeverse.com">support@jubileeverse.com</a>
          </p>
          <p>
            Website: <a href="https://jubileeverse.com">jubileeverse.com</a>
          </p>
        </div>
      </Modal>
    </>
  );
}
