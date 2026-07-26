import Navbar from "@/components/feature/Navbar";
import Footer from "@/components/feature/Footer";
import HeroSection from "./components/HeroSection";
import LearnerExperience from "./components/LearnerExperience";
import TeacherSpotlight from "./components/TeacherSpotlight";
import CTASection from "./components/CTASection";

export default function Home() {
  return (
    <div className="min-h-screen bg-background-50">
      <Navbar />
      <main>
        <HeroSection />
        <LearnerExperience />
        <TeacherSpotlight />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}