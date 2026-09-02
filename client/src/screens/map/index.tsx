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

type RouteTurn = {
  distanceFromStart: number;
  angle: number;
  signedAngle: number;
  direction: "left" | "right";
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

  const groupedTurnsRef = useRef<RouteTurn[]>([]);
  const [groupedTurns, setGropedTurns] = useState([]);

  const simulationSpeedRef = useRef(0);
  const baseSpeedRef = useRef(baseSpeed);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    baseSpeedRef.current = baseSpeed;
  }, [baseSpeed]);

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

  const calculateBearing = (
    point1: Coordinates,
    point2: Coordinates,
  ): number => {
    const lat1 = (point1.latitude * Math.PI) / 180;
    const lat2 = (point2.latitude * Math.PI) / 180;

    const deltaLon = ((point2.longitude - point1.longitude) * Math.PI) / 180;

    const y = Math.sin(deltaLon) * Math.cos(lat2);

    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

    const bearing = (Math.atan2(y, x) * 180) / Math.PI;

    return (bearing + 360) % 360;
  };

  const calculateSignedTurnAngle = (
    previousBearing: number,
    currentBearing: number,
  ): number => {
    let difference = currentBearing - previousBearing;

    if (difference > 180) {
      difference -= 360;
    }

    if (difference < -180) {
      difference += 360;
    }

    return difference;
  };

  const getRoadSpeedMultiplier = (turnAngle: number): number => {
    if (turnAngle <= 5) {
      return 1.0;
    }

    if (turnAngle <= 15) {
      return 0.85;
    }

    if (turnAngle <= 30) {
      return 0.65;
    }

    if (turnAngle <= 45) {
      return 0.45;
    }

    if (turnAngle <= 70) {
      return 0.3;
    }

    return 0.2;
  };

  const groupNearbyTurns = (turns: RouteTurn[]): RouteTurn[] => {
    if (turns.length === 0) {
      return [];
    }

    const grouped: RouteTurn[] = [];

    const GROUP_DISTANCE = 25; // meters

    let currentGroup: RouteTurn[] = [turns[0]];

    for (let i = 1; i < turns.length; i++) {
      const previousTurn = currentGroup[currentGroup.length - 1];

      const currentTurn = turns[i];

      const distanceBetween =
        currentTurn.distanceFromStart - previousTurn.distanceFromStart;

      if (distanceBetween <= GROUP_DISTANCE) {
        currentGroup.push(currentTurn);
      } else {
        const strongestTurn = currentGroup.reduce((strongest, turn) =>
          turn.angle > strongest.angle ? turn : strongest,
        );

        grouped.push(strongestTurn);

        currentGroup = [currentTurn];
      }
    }

    const strongestTurn = currentGroup.reduce((strongest, turn) =>
      turn.angle > strongest.angle ? turn : strongest,
    );

    grouped.push(strongestTurn);

    return grouped;
  };

  const getUpcomingTurn = (
    currentDistance: number,
    turns: RouteTurn[],
  ): RouteTurn | null => {
    for (const turn of turns) {
      if (turn.distanceFromStart > currentDistance) {
        return turn;
      }
    }

    return null;
  };

  const getTurnDirection = (angle: number): string => {
    // Your current RouteTurn only stores absolute angle,
    // so direction cannot be determined from it.
    // For now, classify the maneuver by severity.
    if (angle >= 100) {
      return "Sharp turn";
    }

    if (angle >= 70) {
      return "Turn";
    }

    if (angle >= 45) {
      return "Gentle turn";
    }

    return "Curve";
  };

  const calculateDynamicTargetSpeed = (
    currentSpeedKmh: number,
    baseSpeedKmh: number,
    distanceToTurn: number,
    turnAngle: number,
  ): number => {
    const turnSpeed = baseSpeedKmh * getRoadSpeedMultiplier(turnAngle);

    // Already at the turn.
    if (distanceToTurn <= 0) {
      return turnSpeed;
    }

    const currentSpeedMps = currentSpeedKmh / 3.6;
    const turnSpeedMps = turnSpeed / 3.6;

    const DECELERATION = 2.5;

    /*
     * Maximum speed we can have at the turn
     * while still being able to decelerate to
     * the desired turn speed.
     *
     * v² = u² + 2as
     *
     * Rearranged:
     *
     * u² = v² + 2as
     */
    const physicallyRequiredSpeedMps = Math.sqrt(
      Math.max(
        0,
        turnSpeedMps * turnSpeedMps + 2 * DECELERATION * distanceToTurn,
      ),
    );

    const physicallyRequiredSpeedKmh = physicallyRequiredSpeedMps * 3.6;

    /*
     * Never exceed the base road speed.
     */
    return Math.min(
      baseSpeedKmh,
      Math.max(turnSpeed, physicallyRequiredSpeedKmh),
    );
  };

  const calculateDestinationTargetSpeed = (
    currentSpeedKmh: number,
    distanceToDestination: number,
  ): number => {
    const currentSpeedMps = currentSpeedKmh / 3.6;

    const DECELERATION = 2.5;

    /*
     * Don't calculate a zero-speed target too early.
     *
     * We allow the vehicle to continue moving
     * until it is very close to the destination.
     */
    const STOP_DISTANCE = 1.0;

    if (distanceToDestination <= STOP_DISTANCE) {
      return 0;
    }

    /*
     * Calculate the maximum speed that still allows
     * us to smoothly reach 0 at the destination.
     */
    const maximumAllowedSpeedMps = Math.sqrt(
      2 * DECELERATION * distanceToDestination,
    );

    const maximumAllowedSpeedKmh = maximumAllowedSpeedMps * 3.6;

    return Math.min(baseSpeedRef.current, maximumAllowedSpeedKmh);
  };

  const calculateBrakingDistance = (
    currentSpeedKmh: number,
    targetSpeedKmh: number,
  ): number => {
    const currentSpeedMps = currentSpeedKmh / 3.6;

    const targetSpeedMps = targetSpeedKmh / 3.6;

    const DECELERATION = 1.5; // m/s²

    if (currentSpeedMps <= targetSpeedMps) {
      return 0;
    }

    return (
      (currentSpeedMps * currentSpeedMps - targetSpeedMps * targetSpeedMps) /
      (2 * DECELERATION)
    );
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

    // Gentle acceleration/deceleration.
    // Internally we use meters/second.
    const ACCELERATION = 1.0; // m/s²
    const DECELERATION = 2.5; // m/s²
    const TICK_MS = 100;
    const TICK_SECONDS = TICK_MS / 1000;

    const timer = setInterval(() => {
      // 1. Get current simulation distance
      const currentDistance = simulationDistanceRef.current;

      // 2. Find the upcoming turn
      const upcomingTurn = getUpcomingTurn(
        currentDistance,
        groupedTurnsRef.current,
      );

      // 3. Calculate dynamic target speed
      let targetSpeedKmh = baseSpeedRef.current;

      if (upcomingTurn) {
        const distanceToTurn = upcomingTurn.distanceFromStart - currentDistance;

        const currentSpeedKmh = simulationSpeedRef.current * 3.6;

        targetSpeedKmh = calculateDynamicTargetSpeed(
          currentSpeedKmh,
          baseSpeedRef.current,
          distanceToTurn,
          upcomingTurn.angle,
        );

        const turnSpeed =
          baseSpeedRef.current * getRoadSpeedMultiplier(upcomingTurn.angle);

        const brakingDistance = calculateBrakingDistance(
          currentSpeedKmh,
          turnSpeed,
        );

        const brakingTrigger = brakingDistance;

        console.log("Dynamic target speed:", targetSpeedKmh.toFixed(1), "km/h");

        console.log(
          "Upcoming turn:",
          `in=${distanceToTurn.toFixed(1)}m`,
          `angle=${upcomingTurn.angle.toFixed(1)}°`,
        );

        console.log("Turn speed:", `${turnSpeed.toFixed(1)} km/h`);

        console.log(
          "Braking distance:",
          `${brakingDistance.toFixed(1)}m`,
          "+ buffer=5m",
        );

        console.log("Braking trigger:", `${brakingTrigger.toFixed(1)}m`);

        console.log("Target speed:", `${targetSpeedKmh.toFixed(1)} km/h`);
      } else {
        const distanceToDestination =
          lastPoint.distanceFromStart - currentDistance;

        const currentSpeedKmh = simulationSpeedRef.current * 3.6;

        targetSpeedKmh = calculateDestinationTargetSpeed(
          currentSpeedKmh,
          distanceToDestination,
        );

        console.log(
          "No upcoming turn.",
          `Destination in=${distanceToDestination.toFixed(1)}m`,
        );

        console.log(
          "Destination target speed:",
          `${targetSpeedKmh.toFixed(1)} km/h`,
        );
      }

      // 4. Convert target speed to m/s
      const targetSpeedMps = targetSpeedKmh / 3.6;

      // Current simulation speed is stored internally
      // as meters/second.
      let currentSpeed = simulationSpeedRef.current;

      // 5. Smooth acceleration
      if (currentSpeed < targetSpeedMps) {
        currentSpeed = Math.min(
          currentSpeed + ACCELERATION * TICK_SECONDS,
          targetSpeedMps,
        );
      }

      // 6. Smooth deceleration
      if (currentSpeed > targetSpeedMps) {
        currentSpeed = Math.max(
          currentSpeed - DECELERATION * TICK_SECONDS,
          targetSpeedMps,
        );
      }

      // Keep internal speed in m/s.
      simulationSpeedRef.current = currentSpeed;

      // 7. Move along the route
      simulationDistanceRef.current += currentSpeed * TICK_SECONDS;

      // Never move beyond destination.
      if (simulationDistanceRef.current >= lastPoint.distanceFromStart) {
        simulationDistanceRef.current = lastPoint.distanceFromStart;
      }

      const updatedDistance = simulationDistanceRef.current;

      // 8. Update simulation distance
      setSimulationDistance(updatedDistance);

      // 9. Convert speed to km/h for UI
      const currentSpeedKmh = currentSpeed * 3.6;

      setSimulationSpeed(currentSpeedKmh);

      console.log("Simulation speed:", currentSpeedKmh.toFixed(1), "km/h");

      console.log("Simulation distance:", updatedDistance.toFixed(2), "m");

      // 10. Distance remaining
      const remaining = lastPoint.distanceFromStart - updatedDistance;

      const safeRemaining = Math.max(0, remaining);

      setDistanceRemaining(safeRemaining);

      console.log("Distance remaining:", safeRemaining.toFixed(2), "m");

      // 11. ETA
      const estimatedTimeRemaining =
        currentSpeed > 0 ? safeRemaining / currentSpeed : 0;

      setEta(estimatedTimeRemaining);

      console.log("ETA:", estimatedTimeRemaining.toFixed(2), "seconds");

      // 12. Progress
      const totalDistance = lastPoint.distanceFromStart;

      const currentProgress =
        totalDistance > 0
          ? Math.min(100, Math.max(0, (updatedDistance / totalDistance) * 100))
          : 0;

      setProgress(currentProgress);

      console.log("Progress:", currentProgress.toFixed(2), "%");

      // 13. Calculate simulated position
      // This does NOT control a marker.
      const position = interpolatePosition(routeCoordinates, updatedDistance);

      console.log("Simulation:", updatedDistance, "m →", position);

      setSimulationPosition(position);

      // 14. Destination reached
      const DESTINATION_TOLERANCE = 1.0;

      if (
        lastPoint.distanceFromStart - simulationDistanceRef.current <=
        DESTINATION_TOLERANCE
      ) {
        clearInterval(timer);

        simulationDistanceRef.current = lastPoint.distanceFromStart;

        simulationSpeedRef.current = 0;

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
    }, TICK_MS);

    return () => {
      clearInterval(timer);
    };
  }, [isNavigating, isPaused, routeCoordinates]);

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

    const detectedTurns: RouteTurn[] = [];

    for (let i = 2; i < routeWithDistances.length; i++) {
      const pointBeforePrevious = routeWithDistances[i - 2];
      const previousPoint = routeWithDistances[i - 1];
      const currentPoint = routeWithDistances[i];

      const previousBearing = calculateBearing(
        pointBeforePrevious,
        previousPoint,
      );

      const currentBearing = calculateBearing(previousPoint, currentPoint);

      const signedAngle = calculateSignedTurnAngle(
        previousBearing,
        currentBearing,
      );

      const turnAngle = Math.abs(signedAngle);

      if (turnAngle >= 15) {
        detectedTurns.push({
          distanceFromStart: previousPoint.distanceFromStart,
          angle: turnAngle,
          signedAngle,
          direction: signedAngle < 0 ? "left" : "right",
        });
      }
    }

    const groupedTurns = groupNearbyTurns(detectedTurns);

    groupedTurnsRef.current = groupedTurns;
    // setGropedTurns(groupNearbyTurns)

    console.log("----- GROUPED TURNS -----");

    groupedTurns.forEach((turn, index) => {
      console.log(
        `Turn ${index + 1}:`,
        `distance=${turn.distanceFromStart.toFixed(1)}m`,
        `angle=${turn.angle.toFixed(1)}°`,
      );
    });

    console.log("----- END GROUPED TURNS -----");

    setRouteCoordinates(routeWithDistances);

    console.log("----- ROUTE GEOMETRY ANALYSIS -----");

    for (let i = 2; i < routeWithDistances.length; i++) {
      const pointBeforePrevious = routeWithDistances[i - 2];
      const previousPoint = routeWithDistances[i - 1];
      const currentPoint = routeWithDistances[i];

      const previousBearing = calculateBearing(
        pointBeforePrevious,
        previousPoint,
      );

      const currentBearing = calculateBearing(previousPoint, currentPoint);

      const turnAngle = calculateSignedTurnAngle(
        previousBearing,
        currentBearing,
      );

      const speedMultiplier = getRoadSpeedMultiplier(turnAngle);

      const targetSpeed = baseSpeed * speedMultiplier;

      console.log(
        `Segment ${i}:`,
        `distance=${currentPoint.distanceFromStart.toFixed(1)}m`,
        `bearing=${currentBearing.toFixed(1)}°`,
        `turn=${turnAngle.toFixed(1)}°`,
        `multiplier=${speedMultiplier.toFixed(2)}`,
        `targetSpeed=${targetSpeed.toFixed(1)} km/h`,
      );
    }

    console.log("----- END ROUTE GEOMETRY ANALYSIS -----");

    setIsNavigating(false);
    setIsPaused(false);
    setIsDestinationReached(false);

    simulationDistanceRef.current = 0;
    simulationSpeedRef.current = 0;

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
    simulationSpeedRef.current = 0;

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
