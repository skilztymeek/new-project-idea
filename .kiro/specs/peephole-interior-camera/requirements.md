# Requirements Document

## Introduction

The Peephole Interior Camera is a smart home security device that mounts on the inside of a front door and uses the existing peephole (door viewer hole) as its optical path to see outside. It provides live video streaming, motion detection, two-way audio, and event recording — similar in function to a Ring doorbell camera — without requiring any exterior installation or modification to the door's exterior appearance. The device connects to the home's Wi-Fi network and is managed through a companion mobile application.

## Glossary

- **Camera**: The peephole interior camera hardware device mounted on the inside of the door.
- **Peephole_Lens**: The wide-angle optical lens assembly that fits into the existing door viewer hole and captures the exterior field of view.
- **App**: The companion mobile application (iOS and Android) used to configure, monitor, and control the Camera.
- **User**: The homeowner or authorized resident who has registered the Camera to their account.
- **Visitor**: A person detected in the Camera's field of view outside the door.
- **Motion_Zone**: A configurable region within the Camera's field of view used to trigger motion alerts.
- **Event**: A recorded video clip triggered by motion detection, doorbell press, or manual capture.
- **Live_Stream**: A real-time video and audio feed from the Camera to the App.
- **Cloud_Storage**: Remote server infrastructure used to store recorded Events.
- **Local_Storage**: An optional on-device SD card used to store recorded Events locally.
- **Notification**: A push alert sent to the User's mobile device.
- **Two_Way_Audio**: Bidirectional audio communication between the User (via App) and a Visitor (via Camera speaker/microphone).
- **Night_Vision**: Infrared illumination that enables the Camera to capture video in low-light or dark conditions.
- **Privacy_Mode**: A state in which the Camera suspends all video capture and streaming.
- **Firmware**: The embedded software running on the Camera hardware.

---

## Requirements

### Requirement 1: Physical Mounting and Optical Integration

**User Story:** As a User, I want to mount the Camera on the inside of my door using the existing peephole hole, so that I can see outside without modifying the door's exterior appearance.

#### Acceptance Criteria

1. THE Camera SHALL fit doors with standard peephole hole diameters between 14mm and 16mm without requiring drilling or exterior modification.
2. THE Camera SHALL include a mounting bracket that secures the device to the interior door surface using adhesive or screw-based attachment.
3. THE Peephole_Lens SHALL provide a minimum 160-degree horizontal field of view to capture the area directly outside the door.
4. WHEN the Peephole_Lens is installed, THE Camera SHALL maintain the door's ability to open and close without obstruction.
5. THE Camera SHALL weigh no more than 300 grams to avoid stressing standard interior door surfaces.

---

### Requirement 2: Live Video Streaming

**User Story:** As a User, I want to view a live video feed from the Camera on my phone, so that I can see who is at my door in real time from anywhere.

#### Acceptance Criteria

1. WHEN the User initiates a Live_Stream in the App, THE Camera SHALL begin transmitting video within 3 seconds.
2. WHILE a Live_Stream is active, THE Camera SHALL transmit video at a minimum resolution of 1080p at 15 frames per second.
3. WHILE a Live_Stream is active, THE Camera SHALL maintain end-to-end video latency below 2 seconds under normal Wi-Fi conditions.
4. IF the Wi-Fi connection is lost during a Live_Stream, THEN THE Camera SHALL attempt to reconnect every 30 seconds and notify the User via Notification when reconnection succeeds.
5. THE Camera SHALL support simultaneous Live_Stream access by up to 3 authorized App sessions.

---

### Requirement 3: Motion Detection and Alerts

**User Story:** As a User, I want to receive alerts when motion is detected outside my door, so that I am aware of Visitors or activity without actively monitoring the Camera.

#### Acceptance Criteria

1. WHEN motion is detected within the Camera's field of view, THE Camera SHALL send a Notification to the User's App within 5 seconds of detection.
2. WHEN motion is detected, THE Camera SHALL begin recording an Event clip of at least 30 seconds duration.
3. THE App SHALL allow the User to define up to 4 Motion_Zones within the Camera's field of view.
4. WHILE a Motion_Zone is configured, THE Camera SHALL trigger motion alerts only for motion occurring within the defined Motion_Zone boundaries.
5. THE App SHALL allow the User to set a motion sensitivity level with at least 3 distinct settings: low, medium, and high.
6. WHILE Privacy_Mode is active, THE Camera SHALL suppress all motion detection and Notifications.

---

### Requirement 4: Two-Way Audio Communication

**User Story:** As a User, I want to speak with a Visitor through the Camera, so that I can communicate without opening the door.

#### Acceptance Criteria

1. WHEN the User activates Two_Way_Audio in the App during a Live_Stream, THE Camera SHALL transmit the User's voice to the external speaker within 1 second.
2. WHILE Two_Way_Audio is active, THE Camera SHALL capture audio from the external microphone and transmit it to the App with end-to-end latency below 1 second.
3. THE Camera SHALL include an echo cancellation mechanism to prevent audio feedback during Two_Way_Audio sessions.
4. WHILE Two_Way_Audio is active, THE Camera SHALL record both audio channels as part of the associated Event.
5. IF the User ends the Two_Way_Audio session, THEN THE Camera SHALL immediately cease transmitting audio to the external speaker.

---

### Requirement 5: Night Vision

**User Story:** As a User, I want the Camera to capture clear video at night or in low-light conditions, so that I can identify Visitors regardless of the time of day.

#### Acceptance Criteria

1. WHEN ambient light levels fall below 1 lux, THE Camera SHALL automatically activate Night_Vision using infrared illumination.
2. WHILE Night_Vision is active, THE Camera SHALL capture video at a minimum resolution of 720p.
3. WHEN ambient light levels rise above 5 lux, THE Camera SHALL automatically deactivate Night_Vision and resume standard color video capture.
4. THE Camera SHALL transition between Night_Vision and standard video modes within 2 seconds of the triggering light level change.

---

### Requirement 6: Event Recording and Storage

**User Story:** As a User, I want motion-triggered and manually captured video clips to be saved and accessible, so that I can review past activity at my door.

#### Acceptance Criteria

1. WHEN an Event is recorded, THE Camera SHALL upload the Event clip to Cloud_Storage within 60 seconds of recording completion, provided a Wi-Fi connection is available.
2. THE App SHALL allow the User to view, download, and delete stored Events.
3. THE Cloud_Storage SHALL retain Events for a minimum of 30 days before automatic deletion.
4. WHERE Local_Storage is installed, THE Camera SHALL write Event clips to the Local_Storage in addition to Cloud_Storage.
5. IF Cloud_Storage upload fails due to a network error, THEN THE Camera SHALL retry the upload at 5-minute intervals for up to 24 hours.
6. IF Local_Storage capacity is full, THEN THE Camera SHALL overwrite the oldest Events to accommodate new recordings.

---

### Requirement 7: Power Management

**User Story:** As a User, I want the Camera to operate reliably on battery power, so that I can install it without running new wiring.

#### Acceptance Criteria

1. THE Camera SHALL operate on an internal rechargeable battery providing a minimum of 3 months of standby operation under typical usage conditions (defined as 10 motion events per day, each triggering a 30-second recording).
2. WHEN the Camera battery level falls below 20%, THE Camera SHALL send a low-battery Notification to the User's App.
3. WHEN the Camera battery level falls below 5%, THE Camera SHALL send a critical-battery Notification and enter a reduced-function mode that preserves motion detection and Notifications while suspending Live_Stream capability.
4. THE Camera SHALL support USB-C charging and resume normal operation within 10 seconds of a charging cable being connected.
5. WHERE a hardwired power option is used, THE Camera SHALL accept 5V DC input via USB-C and operate without drawing from the internal battery.

---

### Requirement 8: Privacy Mode

**User Story:** As a User, I want to disable the Camera's recording and streaming when I am home, so that my household activities are not captured.

#### Acceptance Criteria

1. WHEN the User activates Privacy_Mode in the App, THE Camera SHALL cease all video capture, Live_Stream transmission, and motion detection within 2 seconds.
2. WHILE Privacy_Mode is active, THE Camera SHALL display a visible LED indicator to confirm the Camera is not recording.
3. WHEN the User deactivates Privacy_Mode in the App, THE Camera SHALL resume normal operation within 3 seconds.
4. THE App SHALL allow the User to configure a Privacy_Mode schedule based on time of day and day of week.
5. WHILE Privacy_Mode is active, THE Camera SHALL remain connected to Wi-Fi and continue to receive App commands.

---

### Requirement 9: Device Setup and Wi-Fi Connectivity

**User Story:** As a User, I want to set up the Camera quickly using the App, so that I can get it running without technical expertise.

#### Acceptance Criteria

1. THE App SHALL guide the User through Camera setup in 5 steps or fewer, completing the full setup process in under 5 minutes under normal conditions.
2. WHEN the User initiates setup, THE Camera SHALL broadcast a temporary Wi-Fi access point that the App connects to for initial configuration.
3. WHEN the User provides Wi-Fi credentials via the App, THE Camera SHALL connect to the home Wi-Fi network within 30 seconds.
4. THE Camera SHALL support 2.4 GHz and 5 GHz Wi-Fi networks using WPA2 or WPA3 security protocols.
5. IF the Camera loses its Wi-Fi connection, THEN THE Camera SHALL automatically attempt reconnection using stored credentials at 30-second intervals.
6. WHEN the Camera successfully reconnects to Wi-Fi after an outage, THE Camera SHALL send a connectivity-restored Notification to the User's App.

---

### Requirement 10: Multi-User Access and Account Management

**User Story:** As a User, I want to share Camera access with household members, so that everyone in the home can monitor the door.

#### Acceptance Criteria

1. THE App SHALL allow the primary User to invite up to 5 additional users to access the Camera.
2. WHEN an invited user accepts the invitation, THE App SHALL grant that user access to Live_Stream, Event history, and Notifications for the shared Camera.
3. THE App SHALL allow the primary User to revoke access for any shared user at any time.
4. WHEN the primary User revokes a shared user's access, THE Camera SHALL reject Live_Stream and command requests from that user's App session within 60 seconds.
5. THE App SHALL allow the primary User to assign a "guest" access level that permits Live_Stream viewing but restricts Event deletion and Camera configuration changes.

---

### Requirement 11: Firmware Updates

**User Story:** As a User, I want the Camera firmware to stay up to date automatically, so that I receive security patches and new features without manual intervention.

#### Acceptance Criteria

1. WHEN a new Firmware version is available, THE Camera SHALL download and install the update automatically during a low-activity period between 2:00 AM and 5:00 AM local time.
2. WHEN a Firmware update begins, THE Camera SHALL send a Notification to the User's App indicating the update has started.
3. WHEN a Firmware update completes successfully, THE Camera SHALL resume normal operation within 60 seconds and send a completion Notification to the User's App.
4. IF a Firmware update fails, THEN THE Camera SHALL revert to the previously installed Firmware version and send a failure Notification to the User's App.
5. THE App SHALL allow the User to manually trigger a Firmware update check at any time.
6. WHILE a Firmware update is in progress, THE Camera SHALL continue to detect motion and send Notifications, but SHALL suspend Live_Stream capability.
