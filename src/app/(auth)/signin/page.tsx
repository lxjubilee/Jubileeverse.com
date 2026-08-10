import JubileeDoor from '@/components/auth/JubileeDoor';

// The "one door": /signin and /signup render the same email-first Jubilee ID flow.
export default function SignInPage() {
  return <JubileeDoor />;
}
