import { Landing } from "@/components/landing/landing";
import { uploadsOn } from "@/lib/access";

export default function LandingPage() {
  return <Landing uploads={uploadsOn()} />;
}
