import { useEffect, useRef } from "react";
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

type Props = {
  location: Coordinates | null;
  routeCoordinates: RoutePoint[];
  simulationDistance: number;
  destination: Coordinates | null;
  onDestinationSelect: (coordinates: Coordinates) => void;
  onRouteReady: (coordinates: number[][]) => void;
};

const MapScreenView = ({
  location,
  routeCoordinates,
  destination,
  onDestinationSelect,
  onRouteReady,
  simulationDistance,
}: Props) => {
  const mapRef = useRef<MapView>(null);

  const insets = useSafeAreaInsets();

  /*
   * Used to ignore an older OSRM response
   * if the user selects another destination
   * before the previous request finishes.
   */
  const routeRequestId = useRef(0);

  /*
   * Keep the latest GPS location available
   * when a destination is selected.
   */
  const locationRef = useRef<Coordinates | null>(location);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  /*
   * Keep the Google Map camera following
   * the current GPS location for now.
   */
  useEffect(() => {
    if (!location) {
      return;
    }

    console.log("Google Map location updated:", location);

    mapRef.current?.animateToRegion(
      {
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      500,
    );
  }, [location]);

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
      "?overview=full&geometries=geojson";

    try {
      console.log("Requesting OSRM route:", requestId);
      console.log("URL:", url);

      const response = await fetch(url);

      console.log("OSRM HTTP status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();

        throw new Error(`OSRM HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      console.log("OSRM response code:", data.code);

      /*
       * A newer request has already been made.
       * Ignore this old response.
       */
      if (requestId !== routeRequestId.current) {
        console.log("Ignoring old route:", requestId);
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
       * Send the raw OSRM coordinates to MapScreen.
       *
       * OSRM format:
       *
       * [longitude, latitude]
       *
       * MapScreen already knows how to convert
       * these and calculate cumulative distance.
       */
      onRouteReady(route.geometry.coordinates);
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

    const selectedDestination = {
      latitude,
      longitude,
    };

    console.log("Google Map pressed:", latitude, longitude);

    /*
     * Send destination to MapScreen.
     */
    onDestinationSelect(selectedDestination);

    /*
     * Get latest GPS position.
     */
    const currentLocation = locationRef.current;

    if (!currentLocation) {
      console.log("Cannot calculate route: GPS location not available.");

      return;
    }

    /*
     * Calculate OSRM route.
     */
    calculateRoute(currentLocation, selectedDestination);
  };

  /*
   * Center the map on the current user location.
   */
  const centerOnUser = () => {
    if (!location) {
      return;
    }

    mapRef.current?.animateToRegion(
      {
        latitude: location.latitude,
        longitude: location.longitude,
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
    if (routeCoordinates.length === 0) {
      return [];
    }

    /*
     * At the beginning, show the complete route.
     */
    if (simulationDistance <= 0) {
      return routeCoordinates.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
      }));
    }

    const lastPoint = routeCoordinates[routeCoordinates.length - 1];

    /*
     * Destination reached.
     *
     * Keep only the destination point.
     */
    if (simulationDistance >= lastPoint.distanceFromStart) {
      return [
        {
          latitude: lastPoint.latitude,
          longitude: lastPoint.longitude,
        },
      ];
    }

    /*
     * Find the route segment containing
     * the current simulation distance.
     */
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

    /*
     * Calculate the exact coordinate where
     * the simulation currently is.
     */
    const latitude =
      previousPoint.latitude +
      (currentPoint.latitude - previousPoint.latitude) * t;

    const longitude =
      previousPoint.longitude +
      (currentPoint.longitude - previousPoint.longitude) * t;

    /*
     * Start the visible polyline at the
     * simulated position.
     */
    const remainingCoordinates = [
      {
        latitude,
        longitude,
      },
    ];

    /*
     * Add the remaining road geometry.
     */
    for (let i = segmentIndex; i < routeCoordinates.length; i++) {
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
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass
        onPress={handleMapPress}
      >
        {/*
         * Current GPS location.
         */}
        {location && (
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
              anchor={{
                x: 0.5,
                y: 0.5,
              }}
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

        {/*
         * Complete OSRM route.
         *
         * This comes from the SAME
         * routeCoordinates that your
         * MapScreen navigation engine
         * already calculates.
         */}
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
};

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
