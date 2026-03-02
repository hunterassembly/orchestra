import type { PropsWithChildren } from "react";
import { Text, View } from "react-native";

type StackScreenProps = {
  name: string;
};

type StackComponent = ((props: PropsWithChildren) => JSX.Element) & {
  Screen: (props: StackScreenProps) => JSX.Element;
};

const MockStack = (({ children }: PropsWithChildren) => {
  return <View testID="stack">{children}</View>;
}) as StackComponent;

MockStack.Screen = ({ name }: StackScreenProps) => <Text>{name}</Text>;

export const Stack = MockStack;
