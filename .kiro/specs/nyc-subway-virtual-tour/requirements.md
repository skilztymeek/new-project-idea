# Requirements Document

## Introduction

The NYC Subway Virtual Tour is a mobile and web application that allows users to explore New York City subway station interiors in an immersive 360-degree format, similar to Google Maps Street View. Users can navigate between stations, view panoramic imagery of platforms, mezzanines, and entrances, and access station metadata. The app is designed for broad public use and will support monetization through advertisements and optional subscription tiers as the user base grows.

## Glossary

- **App**: The NYC Subway Virtual Tour mobile and web application
- **User**: Any person accessing the App, authenticated or anonymous
- **Station**: A named NYC subway station with one or more associated panoramic scenes
- **Scene**: A single 360-degree panoramic image or video capture of a specific location within a Station
- **Hotspot**: An interactive marker within a Scene that links to an adjacent Scene or provides contextual information
- **Viewer**: The in-app 360-degree rendering component responsible for displaying Scenes
- **Station_Index**: The searchable catalog of all available Stations
- **Free_Tier**: The default access level available to all Users without payment
- **Premium_Tier**: The paid subscription access level with enhanced features and no advertisements
- **Ad_Engine**: The component responsible for serving advertisements to Free_Tier Users
- **Auth_Service**: The component responsible for user registration, login, and session management

---

## Requirements

### Requirement 1: Station Discovery and Search

**User Story:** As a user, I want to search for and browse NYC subway stations, so that I can find and navigate to the station I want to explore.

#### Acceptance Criteria

1. THE Station_Index SHALL contain all currently operational NYC subway stations.
2. WHEN a User enters a search query of one or more characters, THE Station_Index SHALL return matching Stations filtered by name, borough, or subway line within 500ms.
3. WHEN a User selects a Station from search results, THE App SHALL load the Station's primary Scene.
4. THE App SHALL display a browsable map view showing the geographic locations of all available Stations.
5. WHEN a User taps a Station marker on the map, THE App SHALL display a preview card with the Station name, available lines, and an option to enter the virtual tour.
6. IF no Stations match a search query, THEN THE Station_Index SHALL display a "no results found" message and suggest nearby or popular Stations.

---

### Requirement 2: 360-Degree Scene Viewing

**User Story:** As a user, I want to view immersive 360-degree panoramas of subway station interiors, so that I can explore the station as if I were physically present.

#### Acceptance Criteria

1. WHEN a Scene is loaded, THE Viewer SHALL render the 360-degree panoramic image in an interactive, navigable format.
2. WHILE a Scene is displayed, THE Viewer SHALL respond to touch gestures (swipe, pinch-to-zoom) and device gyroscope input to pan and tilt the view.
3. WHILE a Scene is displayed, THE Viewer SHALL maintain a minimum frame rate of 30 frames per second on devices meeting the minimum hardware specification.
4. WHEN a User pinches to zoom, THE Viewer SHALL adjust the field of view between 60 and 120 degrees.
5. THE Viewer SHALL display Hotspots as interactive overlays within the Scene.
6. WHEN a User taps a Hotspot, THE App SHALL transition to the linked Scene with a smooth animated transition.
7. IF a Scene fails to load within 10 seconds, THEN THE Viewer SHALL display an error message and offer a retry option.

---

### Requirement 3: Station Navigation

**User Story:** As a user, I want to navigate between different areas of a subway station, so that I can explore the full layout including platforms, mezzanines, and entrances.

#### Acceptance Criteria

1. THE App SHALL provide a floor plan or schematic mini-map overlay indicating the User's current Scene location within the Station.
2. WHEN a User taps the mini-map, THE App SHALL expand it to a full-screen Station layout view with all available Scenes marked.
3. WHEN a User selects a Scene from the full-screen layout view, THE App SHALL navigate directly to that Scene.
4. THE App SHALL display a breadcrumb or label indicating the current Scene's area (e.g., "Northbound Platform", "Mezzanine", "Street Entrance").
5. WHEN a User navigates to a new Scene, THE App SHALL update the mini-map to reflect the new current location.

---

### Requirement 4: Station Information

**User Story:** As a user, I want to see relevant information about a subway station while exploring it, so that I can understand the station's services, accessibility features, and history.

#### Acceptance Criteria

1. THE App SHALL display a collapsible information panel for each Station containing the station name, serving subway lines, borough, and ADA accessibility status.
2. WHEN a User expands the information panel, THE App SHALL display additional details including station opening year, notable features, and service advisories sourced from the MTA data feed.
3. WHEN the MTA data feed is unavailable, THE App SHALL display the last cached station information and indicate the data's last-updated timestamp.
4. THE App SHALL display real-time train arrival information for each Station sourced from the MTA real-time feed.
5. IF the real-time train arrival feed is unavailable, THEN THE App SHALL display a message indicating live arrivals are temporarily unavailable.

---

### Requirement 5: User Accounts and Authentication

**User Story:** As a user, I want to create an account and log in, so that I can save my favorite stations and access premium features.

#### Acceptance Criteria

1. THE Auth_Service SHALL allow Users to register with an email address and password.
2. THE Auth_Service SHALL allow Users to register and log in using a third-party OAuth provider (Google or Apple).
3. WHEN a User submits a registration form, THE Auth_Service SHALL validate that the email address is in a valid format and that the password is at least 8 characters long.
4. IF a User submits a registration request with an email address already associated with an existing account, THEN THE Auth_Service SHALL return an error message without creating a duplicate account.
5. WHEN a User successfully authenticates, THE Auth_Service SHALL issue a session token valid for 30 days.
6. WHEN a User's session token expires, THE App SHALL prompt the User to log in again before accessing authenticated features.
7. THE App SHALL allow unauthenticated Users to browse and view Scenes without creating an account.

---

### Requirement 6: Favorites and History

**User Story:** As a registered user, I want to save favorite stations and view my recently visited stations, so that I can quickly return to places I care about.

#### Acceptance Criteria

1. WHILE a User is authenticated, THE App SHALL allow the User to mark any Station as a favorite.
2. WHEN a User marks a Station as a favorite, THE App SHALL persist the favorite to the User's account and reflect the change immediately in the UI.
3. THE App SHALL maintain a browsing history of the last 50 Stations visited by an authenticated User.
4. WHEN a User visits a Station they have previously visited, THE App SHALL update the history entry's timestamp rather than creating a duplicate entry.
5. THE App SHALL display the User's favorites list and history list in dedicated sections of the App.
6. WHEN a User removes a Station from their favorites, THE App SHALL remove it from the favorites list immediately.

---

### Requirement 7: Free Tier and Advertisements

**User Story:** As a product owner, I want to display advertisements to free-tier users, so that the app generates revenue to support operations and growth.

#### Acceptance Criteria

1. WHILE a User is on the Free_Tier, THE Ad_Engine SHALL display banner advertisements within the App's non-immersive screens (e.g., search, station info panel).
2. WHILE a User is on the Free_Tier and viewing a Scene, THE Ad_Engine SHALL display a non-intrusive interstitial advertisement after every 5 Scene transitions.
3. THE Ad_Engine SHALL not display advertisements to Premium_Tier Users.
4. WHEN an advertisement is displayed, THE App SHALL provide a clearly labeled close or dismiss option available within 5 seconds.
5. THE Ad_Engine SHALL comply with applicable advertising standards and SHALL not display advertisements categorized as adult content, gambling, or illegal services.

---

### Requirement 8: Premium Subscription

**User Story:** As a user, I want to subscribe to a premium tier, so that I can enjoy an ad-free experience and access exclusive features.

#### Acceptance Criteria

1. THE App SHALL offer a Premium_Tier subscription at a monthly and annual billing frequency.
2. WHEN a User initiates a subscription purchase, THE App SHALL process the payment through the platform's native in-app purchase system (Apple App Store or Google Play Billing).
3. WHEN a User's Premium_Tier subscription is active, THE App SHALL suppress all advertisements.
4. WHEN a User's Premium_Tier subscription expires or is cancelled, THE App SHALL revert the User to Free_Tier access at the end of the current billing period.
5. THE App SHALL display the User's current subscription status and renewal date in the account settings screen.
6. IF a subscription payment fails, THEN THE App SHALL notify the User via in-app message and email and provide a link to update their payment method.

---

### Requirement 9: Offline Access

**User Story:** As a user, I want to download station tours for offline viewing, so that I can explore stations without an active internet connection.

#### Acceptance Criteria

1. WHERE offline download is enabled (Premium_Tier only), THE App SHALL allow Users to download individual Station tour packages for offline viewing.
2. WHEN a User initiates a Station download, THE App SHALL display a progress indicator and estimated download size before confirming.
3. WHILE a User is offline, THE App SHALL allow full Scene navigation within downloaded Stations.
4. IF a User attempts to access a Station that has not been downloaded while offline, THEN THE App SHALL display a message indicating the Station is not available offline.
5. THE App SHALL display the total storage used by downloaded Stations and allow Users to delete individual Station packages.

---

### Requirement 10: Accessibility

**User Story:** As a user with a disability, I want the app to be accessible, so that I can use it with assistive technologies.

#### Acceptance Criteria

1. THE App SHALL conform to WCAG 2.1 Level AA accessibility guidelines for all non-immersive screens.
2. THE App SHALL provide text alternatives for all non-text UI elements on non-immersive screens.
3. WHEN a User navigates the App using a screen reader, THE Viewer SHALL announce the current Scene label and available Hotspot directions.
4. THE App SHALL support dynamic text size adjustments on non-immersive screens in accordance with the host operating system's accessibility settings.
5. WHERE a User has enabled reduced motion in the operating system settings, THE App SHALL disable animated Scene transitions and substitute a direct cut transition.
