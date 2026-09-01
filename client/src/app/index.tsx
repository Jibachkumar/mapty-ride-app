import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapScreen from "../screens/map";

export default function Index() {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.mapContainer}>
          <MapScreen />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  container: {
    flex: 1,
  },

  mapContainer: {
    flex: 1,
  },
});
