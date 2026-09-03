import {
  useEffect,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, View } from "react-native";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
} from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Coordinates = {
  latitude: number;
  longitude: number;
};

type RoutePoint = Coordinates & {
  distanceFromStart: number;
};

type OSRMJunction = {
  location: number[];
  junctionType: "3-way" | "4-way" | "other";
  roads: number;
  maneuverType: string;
  maneuverModifier?: string;
  incomingBearing?: number;
  outgoingBearing?: number;
};

export type MapScreenViewHandle = {
  enterNavigationView: () => void;
  exitNavigationView: () => void;
};

type Props = {
  location: Coordinates | null;
  routeCoordinates: RoutePoint[];
  simulationDistance: number;
  destination: Coordinates | null;
  onDestinationSelect: (coordinates: Coordinates) => void;
  onRouteReady: (coordinates: number[][], junctions: OSRMJunction[]) => void;
  useRealGPS?: boolean;
  mapType?: "standard" | "satellite" | "hybrid";
  customOrigin?: Coordinates | null;
  isPickingOrigin?: boolean;
  onOriginSelect?: (coordinates: Coordinates) => void;
};

const MapScreenView = forwardRef<MapScreenViewHandle, Props>(
  (
    {
      location,
      routeCoordinates,
      destination,
      onDestinationSelect,
      onRouteReady,
      simulationDistance,
      useRealGPS,
      mapType,
      customOrigin,
      isPickingOrigin,
      onOriginSelect,
    },
    ref,
  ) => {
    const mapRef = useRef<MapView>(null);

    const insets = useSafeAreaInsets();

    const routeRequestId = useRef(0);
    const routeInvalidatedRef = useRef(false);
    const [mapKey, setMapKey] = useState(0);

    const locationRef = useRef<Coordinates | null>(location);

    const originRef = useRef<Coordinates | null>(location);

    const isNavigationViewRef = useRef(false);
    const useRealGPSRef = useRef(useRealGPS);
    const routeProgressRef = useRef<{
      position: Coordinates;
      segmentIndex: number;
    } | null>(null);

    useEffect(() => {
      originRef.current = customOrigin ?? location;
    }, [customOrigin, location]);

    useEffect(() => {
      useRealGPSRef.current = useRealGPS;
    }, [useRealGPS]);

    useEffect(() => {
      locationRef.current = location;
    }, [location]);

    /*
     * Single source of truth for "where is the
     * moving marker right now" — used for both
     * the polyline trim AND the navigation-view
     * camera follow, so the two never disagree.
     */
    const getRouteProgress = (): {
      position: Coordinates;
      segmentIndex: number;
    } | null => {
      if (routeCoordinates.length === 0) {
        return null;
      }

      if (simulationDistance <= 0) {
        return {
          position: {
            latitude: routeCoordinates[0].latitude,
            longitude: routeCoordinates[0].longitude,
          },
          segmentIndex: 1,
        };
      }

      const lastPoint = routeCoordinates[routeCoordinates.length - 1];

      if (simulationDistance >= lastPoint.distanceFromStart) {
        return {
          position: {
            latitude: lastPoint.latitude,
            longitude: lastPoint.longitude,
          },
          segmentIndex: routeCoordinates.length - 1,
        };
      }

      let segmentIndex = 1;

      for (let i = 1; i < routeCoordinates.length; i++) {
        if (simulationDistance <= routeCoordinates[i].distanceFromStart) {
          segmentIndex = i;
          break;
        }
      }

      const previousPoint = routeCoordinates[segmentIndex - 1];
      const currentPoint = routeCoordinates[segmentIndex];

      const segmentDistance =
        currentPoint.distanceFromStart - previousPoint.distanceFromStart;

      const distanceIntoSegment =
        simulationDistance - previousPoint.distanceFromStart;

      const t =
        segmentDistance <= 0
          ? 0
          : Math.max(0, Math.min(1, distanceIntoSegment / segmentDistance));

      return {
        position: {
          latitude:
            previousPoint.latitude +
            (currentPoint.latitude - previousPoint.latitude) * t,
          longitude:
            previousPoint.longitude +
            (currentPoint.longitude - previousPoint.longitude) * t,
        },
        segmentIndex,
      };
    };

    const routeProgress = getRouteProgress();

    useEffect(() => {
      routeProgressRef.current = routeProgress;
    });

    /*
     * Keep the Google Map camera following
     * the current GPS location for now.
     */
    useEffect(() => {
      if (!location || !useRealGPS) {
        return;
      }

      console.log("Google Map location updated:", location);

      if (isNavigationViewRef.current) {
        mapRef.current?.animateCamera(
          {
            center: location,
            zoom: 18,
            pitch: 45,
          },
          { duration: 500 },
        );
      } else {
        mapRef.current?.animateToRegion(
          {
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          500,
        );
      }
    }, [location, useRealGPS]);

    /*
     * Follow the SIMULATED marker instead, when
     * Real GPS is off and navigation view is on.
     */
    useEffect(() => {
      if (useRealGPS) {
        return;
      }

      if (!isNavigationViewRef.current || !routeProgress) {
        return;
      }

      mapRef.current?.animateCamera(
        {
          center: routeProgress.position,
          zoom: 18,
          pitch: 45,
        },
        { duration: 400 },
      );
    }, [simulationDistance, routeCoordinates, useRealGPS]);

    useImperativeHandle(
      ref,
      () => ({
        enterNavigationView: () => {
          isNavigationViewRef.current = true;

          const target = useRealGPSRef.current
            ? locationRef.current
            : (routeProgressRef.current?.position ?? locationRef.current);

          if (!target) {
            return;
          }

          mapRef.current?.animateCamera(
            {
              center: target,
              zoom: 18,
              pitch: 45,
            },
            { duration: 600 },
          );
        },
        exitNavigationView: () => {
          isNavigationViewRef.current = false;

          const target =
            locationRef.current ?? routeProgressRef.current?.position;

          if (!target) {
            return;
          }

          mapRef.current?.animateCamera(
            {
              center: target,
              zoom: 15,
              pitch: 0,
            },
            { duration: 600 },
          );
        },
      }),
      [],
    );

    /*
     * Request a driving route from OSRM.
     */
    const calculateRoute = async (
      start: Coordinates,
      destination: Coordinates,
    ) => {
      const requestId = ++routeRequestId.current;

      const url =
        "https://router.project-osrm.org/route/v1/driving/" +
        `${start.longitude},${start.latitude};` +
        `${destination.longitude},${destination.latitude}` +
        "?overview=full&geometries=geojson&steps=true";

      try {
        console.log("Requesting OSRM route:", requestId);

        const response = await fetch(url);

        console.log("OSRM HTTP status:", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OSRM HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        if (
          requestId !== routeRequestId.current ||
          routeInvalidatedRef.current
        ) {
          console.log("Ignoring old/invalid route:", requestId);
          return;
        }

        if (
          data.code !== "Ok" ||
          !Array.isArray(data.routes) ||
          data.routes.length === 0
        ) {
          throw new Error(data.message || "No route was found.");
        }

        const route = data.routes[0];

        if (
          !route.geometry ||
          !Array.isArray(route.geometry.coordinates) ||
          route.geometry.coordinates.length === 0
        ) {
          throw new Error("OSRM returned an empty route.");
        }

        console.log(
          "OSRM route received:",
          route.geometry.coordinates.length,
          "points",
        );

        /*
         * ----------------------------------------
         * JUNCTION DETECTION
         * ----------------------------------------
         */

        const steps = route.legs?.[0]?.steps ?? [];

        const detectedJunctions: OSRMJunction[] = [];

        steps.forEach((step: any, stepIndex: number) => {
          const intersections = step.intersections ?? [];

          intersections.forEach((intersection: any) => {
            if (
              !Array.isArray(intersection.location) ||
              intersection.location.length < 2
            ) {
              return;
            }

            const roads = intersection.bearings?.length ?? 0;

            /*
             * Only interested in 3-way or greater
             * intersections.
             */
            if (roads < 3) {
              return;
            }

            let junctionType: OSRMJunction["junctionType"] = "other";

            if (roads === 3) {
              junctionType = "3-way";
            } else if (roads >= 4) {
              junctionType = "4-way";
            }

            const incomingBearing =
              intersection.in != null && Array.isArray(intersection.bearings)
                ? intersection.bearings[intersection.in]
                : undefined;

            const outgoingBearing =
              intersection.out != null && Array.isArray(intersection.bearings)
                ? intersection.bearings[intersection.out]
                : undefined;

            const junction: OSRMJunction = {
              location: intersection.location,
              junctionType,
              roads,
              maneuverType: step.maneuver?.type ?? "unknown",
              maneuverModifier: step.maneuver?.modifier,
              incomingBearing,
              outgoingBearing,
            };

            detectedJunctions.push(junction);

            console.log("OSRM JUNCTION DETECTED:", {
              stepIndex,
              junctionType,
              roads,
              location: intersection.location,
              maneuverType: step.maneuver?.type,
              maneuverModifier: step.maneuver?.modifier,
              incomingBearing,
              outgoingBearing,
            });
          });
        });

        /*
         * ----------------------------------------
         * REMOVE DUPLICATE JUNCTIONS
         * ----------------------------------------
         */

        const calculateDistance = (
          point1: Coordinates,
          point2: Coordinates,
        ): number => {
          const R = 6371000;

          const lat1 = (point1.latitude * Math.PI) / 180;
          const lat2 = (point2.latitude * Math.PI) / 180;

          const deltaLat =
            ((point2.latitude - point1.latitude) * Math.PI) / 180;

          const deltaLon =
            ((point2.longitude - point1.longitude) * Math.PI) / 180;

          const a =
            Math.sin(deltaLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

          return R * c;
        };

        const uniqueJunctions: OSRMJunction[] = [];

        const JUNCTION_MERGE_DISTANCE = 15;

        for (const junction of detectedJunctions) {
          const alreadyExists = uniqueJunctions.some((existing) => {
            const distance = calculateDistance(
              {
                latitude: existing.location[1],
                longitude: existing.location[0],
              },
              {
                latitude: junction.location[1],
                longitude: junction.location[0],
              },
            );

            return distance <= JUNCTION_MERGE_DISTANCE;
          });

          if (!alreadyExists) {
            uniqueJunctions.push(junction);
          }
        }

        console.log("OSRM JUNCTION COUNT:", uniqueJunctions.length);

        console.log("OSRM JUNCTIONS:", uniqueJunctions);

        /*
         * ----------------------------------------
         * SEND ROUTE + JUNCTIONS TO PARENT
         * ----------------------------------------
         */

        onRouteReady(route.geometry.coordinates, uniqueJunctions);
      } catch (error) {
        if (requestId !== routeRequestId.current) {
          return;
        }

        console.error("OSRM ROUTE ERROR:", error);
      }
    };

    /*
     * User taps the Google Map.
     */
    const handleMapPress = (event: any) => {
      const { latitude, longitude } = event.nativeEvent.coordinate;

      const tappedCoordinate: Coordinates = {
        latitude,
        longitude,
      };

      console.log("MAP PRESSED:", tappedCoordinate);

      if (isPickingOrigin) {
        console.log("NEW INITIAL POSITION:", tappedCoordinate);

        originRef.current = tappedCoordinate;

        routeRequestId.current++;
        routeInvalidatedRef.current = true;

        // Force Google Map to completely remount.
        // This removes the old native Polyline on Android.
        setMapKey((prev) => prev + 1);

        onOriginSelect?.(tappedCoordinate);

        return;
      }

      /*
       * =====================================================
       * NORMAL MODE
       * =====================================================
       *
       * Map taps select a destination.
       */
      console.log("SELECTING DESTINATION:", tappedCoordinate);

      routeInvalidatedRef.current = false;

      onDestinationSelect(tappedCoordinate);

      const currentOrigin = originRef.current;

      if (!currentOrigin) {
        console.log("Cannot calculate route: no origin available.");
        return;
      }

      console.log("ROUTE START:", currentOrigin);
      console.log("ROUTE DESTINATION:", tappedCoordinate);

      calculateRoute(currentOrigin, tappedCoordinate);
    };

    /*
     * Center the map on the current user location.
     */
    const centerOnUser = () => {
      const centerLocation = customOrigin ?? location;

      if (!centerLocation) return;

      mapRef.current?.animateToRegion(
        {
          latitude: centerLocation.latitude,
          longitude: centerLocation.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500,
      );
    };

    /*
     * Convert your existing RoutePoint[]
     * into Google Maps coordinates.
     */
    const googleRouteCoordinates = (() => {
      if (!routeProgress || routeCoordinates.length === 0) {
        return [];
      }

      if (simulationDistance <= 0) {
        return routeCoordinates.map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude,
        }));
      }

      const lastPoint = routeCoordinates[routeCoordinates.length - 1];

      if (simulationDistance >= lastPoint.distanceFromStart) {
        return [routeProgress.position];
      }

      const remainingCoordinates = [routeProgress.position];

      for (
        let i = routeProgress.segmentIndex;
        i < routeCoordinates.length;
        i++
      ) {
        remainingCoordinates.push({
          latitude: routeCoordinates[i].latitude,
          longitude: routeCoordinates[i].longitude,
        });
      }

      return remainingCoordinates;
    })();

    /*
     * Initial map location.
     */
    const initialRegion = {
      latitude: location?.latitude ?? 27.7172,

      longitude: location?.longitude ?? 85.324,

      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };

    return (
      <View style={styles.container}>
        <MapView
          key={mapKey}
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          mapType={mapType ?? "standard"}
          initialRegion={initialRegion}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass
          onPress={handleMapPress}
        >
          {/*
           * Current GPS location.
           */}
          {location && !customOrigin && (
            <>
              <Circle
                center={location}
                radius={25}
                fillColor="rgba(32, 138, 239, 0.15)"
                strokeColor="rgba(32, 138, 239, 0.35)"
                strokeWidth={1}
              />

              <Marker
                coordinate={location}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={10}
              >
                <View style={styles.userMarker}>
                  <View style={styles.userMarkerDot} />
                </View>
              </Marker>
            </>
          )}

          {/*
           * Destination marker.
           */}
          {destination && <Marker coordinate={destination} pinColor="red" />}

          {customOrigin && (
            <Marker
              coordinate={customOrigin}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={10}
            >
              <View style={styles.userMarker}>
                <View style={styles.userMarkerDot} />
              </View>
            </Marker>
          )}

          {googleRouteCoordinates.length > 0 && (
            <Polyline
              coordinates={googleRouteCoordinates}
              strokeWidth={6}
              strokeColor="#208AEF"
              lineCap="round"
              lineJoin="round"
            />
          )}
        </MapView>

        {/*
         * Current-location button.
         */}
        <View
          style={[
            styles.buttonContainer,
            {
              top: insets.top + 16,
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [
              styles.locationButton,
              pressed && styles.locationButtonPressed,
            ]}
            onPress={centerOnUser}
            disabled={!location}
          >
            <View style={styles.locationIcon}>
              <View style={styles.locationIconDot} />
            </View>
          </Pressable>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  map: {
    flex: 1,
  },

  userMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,

    backgroundColor: "#208AEF",

    borderWidth: 4,
    borderColor: "#ffffff",

    alignItems: "center",
    justifyContent: "center",

    elevation: 4,
  },

  userMarkerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,

    backgroundColor: "#ffffff",
  },

  buttonContainer: {
    position: "absolute",
    right: 16,
  },

  locationButton: {
    width: 52,
    height: 52,

    borderRadius: 26,

    backgroundColor: "#ffffff",

    alignItems: "center",
    justifyContent: "center",

    elevation: 5,

    shadowColor: "#000",

    shadowOffset: {
      width: 0,
      height: 2,
    },

    shadowOpacity: 0.2,

    shadowRadius: 5,
  },

  locationButtonPressed: {
    opacity: 0.65,

    transform: [
      {
        scale: 0.95,
      },
    ],
  },

  locationIcon: {
    width: 25,
    height: 25,

    borderRadius: 13,

    borderWidth: 3,

    borderColor: "#208AEF",

    alignItems: "center",
    justifyContent: "center",
  },

  locationIconDot: {
    width: 9,
    height: 9,

    borderRadius: 5,

    backgroundColor: "#208AEF",
  },
});

export default MapScreenView;
