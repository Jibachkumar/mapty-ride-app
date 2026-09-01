import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import * as Location from "expo-location";
import MapScreenView from "./map-view";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";

type Coordinates = {
  latitude: number;
  longitude: number;
};

type RoutePoint = Coordinates & {
  distanceFromStart: number;
};

const MapScreen = () => {
  const [location, setLocation] = useState<Location.LocationObject | null>(
    null,
  );

  const [destination, setDestination] = useState<Coordinates | null>(null);

  const [routeCoordinates, setRouteCoordinates] = useState<RoutePoint[]>([]);

  const simulationDistanceRef = useRef(0);

  const [simulationPosition, setSimulationPosition] =
    useState<Coordinates | null>(null);

  const [simulationDistance, setSimulationDistance] = useState(0);

  const [simulationSpeed, setSimulationSpeed] = useState(0);

  const [isNavigating, setIsNavigating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isDestinationReached, setIsDestinationReached] = useState(false);

  const [distanceRemaining, setDistanceRemaining] = useState(0);

  const [progress, setProgress] = useState(0);

  const [eta, setEta] = useState(0);

  const [baseSpeed, setBaseSpeed] = useState(40);
  const [useRealGPS, setUseRealGPS] = useState(false);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    const startLocation = async () => {
      try {
        console.log("Checking location services...");

        const servicesEnabled = await Location.hasServicesEnabledAsync();

        if (!servicesEnabled) {
          setError("Location services are disabled.");

          setLoading(false);

          return;
        }

        console.log("Requesting location permission...");

        const { status } = await Location.requestForegroundPermissionsAsync();

        console.log("Permission:", status);

        if (status !== Location.PermissionStatus.GRANTED) {
          setError("Location permission was denied.");

          setLoading(false);

          return;
        }

        console.log("Getting current location...");

        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        console.log("Current location:", currentLocation.coords);

        setLocation(currentLocation);

        setLoading(false);

        console.log("Starting location tracking...");

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,

            timeInterval: 2000,

            distanceInterval: 5,
          },

          (newLocation) => {
            console.log("Location update:", newLocation.coords);

            setLocation(newLocation);
          },
        );
      } catch (err) {
        console.error("LOCATION ERROR:", err);

        setError(err instanceof Error ? err.message : String(err));

        setLoading(false);
      }
    };

    startLocation();

    return () => {
      subscription?.remove();
    };
  }, []);

  // calculating geometry distance
  const calculateDistance = (
    point1: Coordinates,
    point2: Coordinates,
  ): number => {
    const R = 6371000;

    const lat1 = (point1.latitude * Math.PI) / 180;
    const lat2 = (point2.latitude * Math.PI) / 180;

    const deltaLat = ((point2.latitude - point1.latitude) * Math.PI) / 180;

    const deltaLon = ((point2.longitude - point1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  const interpolatePosition = (
    route: RoutePoint[],
    distanceAlongRoute: number,
  ): Coordinates => {
    if (route.length === 0) {
      throw new Error("Cannot interpolate an empty route.");
    }

    /*
     * Before the route starts.
     */
    if (distanceAlongRoute <= 0) {
      return {
        latitude: route[0].latitude,
        longitude: route[0].longitude,
      };
    }

    /*
     * At or beyond the destination.
     */
    const lastPoint = route[route.length - 1];

    if (distanceAlongRoute >= lastPoint.distanceFromStart) {
      return {
        latitude: lastPoint.latitude,
        longitude: lastPoint.longitude,
      };
    }

    /*
     * Find the two route points surrounding
     * the requested distance.
     */
    for (let i = 1; i < route.length; i++) {
      const previousPoint = route[i - 1];
      const currentPoint = route[i];

      if (distanceAlongRoute <= currentPoint.distanceFromStart) {
        const segmentDistance =
          currentPoint.distanceFromStart - previousPoint.distanceFromStart;

        /*
         * Position within this particular segment.
         *
         * Example:
         *
         * segment = 20 meters
         * already travelled = 5 meters
         *
         * t = 0.25
         */
        const distanceIntoSegment =
          distanceAlongRoute - previousPoint.distanceFromStart;

        const t =
          segmentDistance === 0 ? 0 : distanceIntoSegment / segmentDistance;

        /*
         * Linear interpolation.
         */
        const latitude =
          previousPoint.latitude +
          (currentPoint.latitude - previousPoint.latitude) * t;

        const longitude =
          previousPoint.longitude +
          (currentPoint.longitude - previousPoint.longitude) * t;

        return {
          latitude,
          longitude,
        };
      }
    }

    /*
     * Safety fallback.
     */
    return {
      latitude: lastPoint.latitude,
      longitude: lastPoint.longitude,
    };
  };

  useEffect(() => {
    if (!isNavigating || isPaused || routeCoordinates.length === 0) {
      return;
    }

    const lastPoint = routeCoordinates[routeCoordinates.length - 1];

    /*
     * Temporary testing speed.
     *
     * This is NOT our final speed implementation.
     * We are only using it to prove that the
     * simulation clock advances along the route.
     *
     * 40 meters per second = 144 km/h.
     */
    const TEST_DISTANCE_PER_SECOND = baseSpeed;

    const timer = setInterval(() => {
      simulationDistanceRef.current += TEST_DISTANCE_PER_SECOND;

      /*
       * Never move beyond the destination.
       */
      if (simulationDistanceRef.current >= lastPoint.distanceFromStart) {
        simulationDistanceRef.current = lastPoint.distanceFromStart;
      }

      const currentDistance = simulationDistanceRef.current;

      setSimulationDistance(simulationDistanceRef.current);

      setSimulationSpeed(TEST_DISTANCE_PER_SECOND);

      console.log("Simulation distance:", simulationDistanceRef.current, "m");

      console.log("Simulation speed:", TEST_DISTANCE_PER_SECOND, "m/s");

      // Distance remaining.
      const remaining =
        lastPoint.distanceFromStart - simulationDistanceRef.current;

      const safeRemaining = Math.max(0, remaining);

      setDistanceRemaining(safeRemaining);

      console.log("Distance remaining:", Math.max(0, remaining), "m");

      // eta
      const estimatedTimeRemaining =
        TEST_DISTANCE_PER_SECOND > 0
          ? safeRemaining / TEST_DISTANCE_PER_SECOND
          : 0;

      setEta(estimatedTimeRemaining);

      console.log("ETA:", estimatedTimeRemaining.toFixed(2), "seconds");

      // progress
      const totalDistance = lastPoint.distanceFromStart;

      const currentProgress =
        totalDistance > 0
          ? Math.min(
              100,
              Math.max(
                0,
                (simulationDistanceRef.current / totalDistance) * 100,
              ),
            )
          : 0;

      setProgress(currentProgress);

      console.log("Progress:", currentProgress.toFixed(2), "%");

      /*
       * Interpolate: Convert distance along route
       * into an actual coordinate.
       */
      const position = interpolatePosition(
        routeCoordinates,
        simulationDistanceRef.current,
      );

      console.log(
        "Simulation:",
        simulationDistanceRef.current,
        "m →",
        position,
      );

      setSimulationPosition(position);

      /*
       * Destination reached: Stop the temporary clock at
       * the destination.
       */
      if (simulationDistanceRef.current >= lastPoint.distanceFromStart) {
        clearInterval(timer);

        setSimulationDistance(lastPoint.distanceFromStart);
        setSimulationSpeed(0);
        setDistanceRemaining(0);
        setEta(0);
        setProgress(100);

        setIsNavigating(false);
        setIsPaused(false);
        setIsDestinationReached(true);

        console.log("Destination reached.");
      }
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [isNavigating, isPaused, routeCoordinates, baseSpeed]);

  const handleRouteReady = (coordinates: number[][]) => {
    console.log("OSRM route received:", coordinates.length, "points");

    const convertedRoute: Coordinates[] = coordinates.map(
      ([longitude, latitude]) => ({
        latitude,
        longitude,
      }),
    );

    console.log("Converted route:", convertedRoute.length, "points");

    if (convertedRoute.length === 0) {
      setRouteCoordinates([]);
      return;
    }

    let cumulativeDistance = 0;

    const routeWithDistances: RoutePoint[] = convertedRoute.map(
      (point, index) => {
        if (index > 0) {
          cumulativeDistance += calculateDistance(
            convertedRoute[index - 1],
            point,
          );
        }

        return {
          ...point,
          distanceFromStart: cumulativeDistance,
        };
      },
    );

    console.log(
      "Route total calculated distance:",
      cumulativeDistance,
      "meters",
    );

    console.log("First route point:", routeWithDistances[0]);

    console.log(
      "Last route point:",
      routeWithDistances[routeWithDistances.length - 1],
    );

    setRouteCoordinates(routeWithDistances);

    setIsNavigating(false);
    setIsPaused(false);
    setIsDestinationReached(false);

    simulationDistanceRef.current = 0;

    setSimulationPosition({
      latitude: routeWithDistances[0].latitude,
      longitude: routeWithDistances[0].longitude,
    });

    setSimulationDistance(0);
    setSimulationSpeed(0);
    setDistanceRemaining(cumulativeDistance);
    setProgress(0);
    setEta(0);
  };

  const handleStart = () => {
    if (routeCoordinates.length === 0) {
      return;
    }

    const lastPoint = routeCoordinates[routeCoordinates.length - 1];

    if (simulationDistanceRef.current >= lastPoint.distanceFromStart) {
      return;
    }

    setIsDestinationReached(false);
    setIsNavigating(true);
    setIsPaused(false);

    console.log("Navigation started.");
  };

  const handleResume = () => {
    if (!isNavigating || !isPaused) {
      return;
    }

    setIsPaused(false);

    console.log("Navigation resumed.");
  };

  const handlePause = () => {
    if (!isNavigating) {
      return;
    }

    setIsPaused(true);

    console.log("Navigation paused.");
  };

  const handleStop = () => {
    console.log("Navigation stopped.");

    setIsNavigating(false);
    setIsPaused(false);
    setIsDestinationReached(false);

    simulationDistanceRef.current = 0;

    setSimulationDistance(0);
    setSimulationSpeed(0);
    setProgress(0);
    setEta(0);

    if (routeCoordinates.length > 0) {
      const lastPoint = routeCoordinates[routeCoordinates.length - 1];

      setDistanceRemaining(lastPoint.distanceFromStart);

      setSimulationPosition({
        latitude: routeCoordinates[0].latitude,
        longitude: routeCoordinates[0].longitude,
      });
    } else {
      setDistanceRemaining(0);
      setSimulationPosition(null);
    }
  };

  const handleLocate = () => {
    console.log("Locate pressed");
  };

  const handleToggleRealGPS = () => {
    setUseRealGPS((prev) => !prev);
  };

  if (loading && !location) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />

        <Text style={styles.text}>Getting your location...</Text>
      </View>
    );
  }

  if (error && !location) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* TOP BAR */}
      <View style={styles.topBar}>
        <Text style={styles.topBarSpeed}>
          Speed: {simulationSpeed.toFixed(0)} km/h
        </Text>
        <View style={styles.topBarIcons}>
          <Pressable style={styles.iconBtn}>
            <Ionicons name="layers-outline" size={18} />
          </Pressable>
          <Pressable style={styles.iconBtn}>
            <Ionicons name="navigate-outline" size={18} />
          </Pressable>
          <Pressable style={styles.iconBtn}>
            <Ionicons name="settings-outline" size={18} />
          </Pressable>
          <Pressable style={styles.iconBtn}>
            <Ionicons name="construct-outline" size={18} />
          </Pressable>
        </View>
      </View>

      {/* TURN INSTRUCTION BANNER */}
      <View style={styles.turnBanner}>
        <Text style={styles.turnBannerTitle}>Turn Left in 1m</Text>
        <Text style={styles.turnBannerSub}>
          {distanceRemaining < 1000
            ? `${Math.round(distanceRemaining)} m left`
            : `${(distanceRemaining / 1000).toFixed(2)} km left`}
          {"  •  ETA "}
          {Math.ceil(eta / 60)} min ({simulationSpeed.toFixed(0)} km/h)
        </Text>
      </View>

      {/* MAP */}
      <View style={styles.mapContainer}>
        <MapScreenView
          location={
            location
              ? {
                  latitude: location.coords.latitude,
                  longitude: location.coords.longitude,
                }
              : null
          }
          destination={destination}
          onDestinationSelect={setDestination}
          onRouteReady={handleRouteReady}
          simulationDistance={simulationDistance}
          routeCoordinates={routeCoordinates}
        />

        {isDestinationReached && (
          <View style={styles.destinationReached}>
            <Text style={styles.destinationReachedText}>
              Destination Reached
            </Text>
          </View>
        )}

        {/* FLOATING PILLS */}
        <View style={styles.floatingPills}>
          <Pressable style={styles.pillBtn} onPress={handleStart}>
            <Ionicons name="play-outline" size={14} />
            <Text style={styles.pillBtnText}>Start</Text>
          </Pressable>

          <Pressable style={styles.pillBtn} onPress={handleLocate}>
            <Ionicons name="locate-outline" size={14} />
            <Text style={styles.pillBtnText}>Locate</Text>
          </Pressable>

          <Pressable
            style={[styles.pillBtn, useRealGPS && styles.pillBtnActive]}
            onPress={handleToggleRealGPS}
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={14}
              color={useRealGPS ? "#fff" : "#000"}
            />
            <Text
              style={[
                styles.pillBtnText,
                useRealGPS && styles.pillBtnTextActive,
              ]}
            >
              Real GPS
            </Text>
          </Pressable>
        </View>
      </View>

      {/* BOTTOM PANEL */}
      <View style={styles.bottomPanel}>
        <Text style={styles.progressLabel}>
          Progress: {progress.toFixed(0)}%
        </Text>

        <View style={styles.sliderRow}>
          <Text style={styles.sliderLabel}>Base Speed: {baseSpeed} km/h</Text>
          <Slider
            style={styles.slider}
            minimumValue={5}
            maximumValue={120}
            step={5}
            value={baseSpeed}
            onValueChange={setBaseSpeed}
            minimumTrackTintColor="#111"
            maximumTrackTintColor="#ccc"
          />
        </View>

        <View style={styles.controlsRow}>
          <Pressable
            style={[styles.ctrlBtn, styles.ctrlStart]}
            onPress={handleStart}
            disabled={routeCoordinates.length === 0}
          >
            <Text style={styles.ctrlBtnText}>START</Text>
          </Pressable>

          <Pressable
            style={[styles.ctrlBtn, styles.ctrlPause]}
            onPress={handlePause}
            disabled={!isNavigating}
          >
            <Text style={styles.ctrlBtnText}>PAUSE</Text>
          </Pressable>

          <Pressable
            style={[styles.ctrlBtn, styles.ctrlStop]}
            onPress={handleStop}
            disabled={!isNavigating && simulationDistance === 0}
          >
            <Text style={styles.ctrlBtnText}>STOP</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  text: {
    marginTop: 12,
    fontSize: 16,
  },

  error: {
    textAlign: "center",
    paddingHorizontal: 20,
    fontSize: 16,
  },

  destinationReached: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#22c55e",
  },

  destinationReachedText: {
    color: "#fff",
    fontWeight: "700",
    textAlign: "center",
  },

  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  topBarSpeed: { fontSize: 15, fontWeight: "700" },
  topBarIcons: { flexDirection: "row", gap: 10 },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#f2f2f2",
    alignItems: "center",
    justifyContent: "center",
  },

  turnBanner: {
    backgroundColor: "#2F80ED",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  turnBannerTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  turnBannerSub: { color: "#dbe9ff", fontSize: 12, marginTop: 2 },

  mapContainer: {
    flex: 1,
    position: "relative",
  },

  floatingPills: {
    position: "absolute",
    right: 14,
    bottom: 20,
    gap: 8,
  },
  pillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  pillBtnActive: { backgroundColor: "#16A34A" },
  pillBtnText: { fontSize: 12, fontWeight: "600" },
  pillBtnTextActive: { color: "#fff" },

  bottomPanel: {
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  progressLabel: { fontSize: 13, color: "#333", marginBottom: 6 },
  sliderRow: { marginBottom: 6 },
  sliderLabel: { fontSize: 13, color: "#333", marginBottom: 2 },
  slider: { width: "100%", height: 32 },

  controlsRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  ctrlBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  ctrlBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  ctrlStart: { backgroundColor: "#22C55E" },
  ctrlPause: { backgroundColor: "#F59E0B" },
  ctrlStop: { backgroundColor: "#EF4444" },
});

export default MapScreen;
