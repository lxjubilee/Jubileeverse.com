import JubileeDoor from '@/components/auth/JubileeDoor';

// The "one door": /signup and /signin render the same email-first Jubilee ID flow.
export default function SignUpPage() {
  return <JubileeDoor />;
}
