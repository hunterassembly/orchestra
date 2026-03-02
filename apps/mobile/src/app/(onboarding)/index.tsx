import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

export default function OnboardingIndexScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/(onboarding)/welcome");
  }, [router]);

  return (
    <View testID="onboarding-screen">
      <ActivityIndicator />
    </View>
  );
}
