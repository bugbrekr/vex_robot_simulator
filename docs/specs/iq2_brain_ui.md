# Spec: IQ (2nd gen) brain user interface and the VS Code extension (as simulated)

Sources:
- [KB-DEV] https://kb.vex.com/hc/en-us/articles/4407061189908 ("Using the Devices Screen - IQ Brain (2nd gen)")
- [KB-VSUI] https://kb.vex.com/hc/en-us/articles/8604273158164 (VS Code UI Overview for IQ)
- [KB-VSNEW] https://kb.vex.com/hc/en-us/articles/8604236587028 (VS Code New Project for IQ)
- [KB-AIR] https://kb.vex.com/hc/en-us/articles/39233320977812 (project files: `.vscode/{extensions,settings,vex_project_settings}.json` and `src/main.py`)
- [MKT] https://marketplace.visualstudio.com/items?itemName=VEXRobotics.vexcode

## Brain (frontend `src/iq2/brainOS.ts`, `brainScreen.ts`, `brainIcons.ts`)

Sources: the KB "Guide to the VEX IQ Brain Screen (2nd gen)" (13595260156820), "Navigating Menus" (4407024174996), "Running User Programs" (360035952591) and "Using the Devices Screen" (4407061189908). Their 160×128 screen captures are the reference for everything below.

### Physical face [REAL, KB 4407018398868 / 4407024320660]
- Ports 1–6 run along the top edge and 7–12 along the bottom.
- Left of the screen, top to bottom: ◀ Left, a speaker grille, ▶ Right.
- Right of the screen, top to bottom: ✓ Check, the status light (green when on), ✕ X.
- On the robot, the face's top edge is the front, so the screen reads upright from behind. Left and Right sit on the robot's left; Check, the status light and X on its right.

### Screen [REAL, from the KB captures]
- **Size:** 160×128 px, light theme.
  - The status bar is the top 20 px, grey (#adafad). On its right are signal bars (grey without a controller), a brain icon, and a battery icon with a green fill and the percentage.
  - The program area is the remaining 160×108 below it, which matches the API's screen size.
- **Menus:**
  - A title band (#e6e6e6) with a large bold title: "Home", "Programs", the project name, "Devices", "Settings".
  - Below it, a carousel showing **three tab-shaped tiles**. The selected tile is black; the others are light grey with dark outlines.
  - Left and Right move the black highlight across the visible tiles. The row scrolls when the highlight passes the edge.
  - A black bottom bar shows the selected option's name in white bold, with ◀ / ▶ when there are more options in that direction.
- **Home:** Drive, Programs, Devices, Settings.
  - Drive opens Run, Controls and Configure. None of them work, because there is no IQ Controller.
- **Programs:** slots 1–8.
  - A downloaded slot shows a blue project icon and its project name.
  - An empty slot shows a grey frame with the slot number.
  - Check opens the project menu: **Run** (works), Controls and Configure (not simulated).
- **Running a program:**
  - The status bar stays on top and the program's 160×108 output is below it. Default colours are black text on white (ESTIMATE, consistent with the light theme).
  - The status bar shows "▶ Slot n", then "Done · X" or "Stopped · X" (ESTIMATE; the KB doesn't show this screen).
  - X stops the program or leaves the finished screen.
  - The status light blinks while a program runs (ESTIMATE).
- **Devices:** one live tile per device, starting with the brain's Inertial sensor, then each plugged-in device in port order.
  - Each tile shows a label, a value and a unit: Inertial Heading on a dotted dial, motor Velocity in RPM, optical Hue on a red ring, Distance in mm, and the bumper and Touch LED states.
  - The bottom bar names the device as "port:Name", e.g. "3:Optical".
  - Check opens the device's dashboard: readings on the left (LED, BRT, PROX for the optical sensor; POS, VEL, CUR for a motor) and a big dial on the right. Check cycles the dial's reading (for the optical sensor: Hue, Brightness, Proximity).
- **Settings,** in the KB's order:
  - Language (English), Link and Calibrate (all need a controller).
  - **System Info:** Version, Name, Team, Battery and Brain ID.
  - **Log:** events newest first with their elapsed time. Power events are green and program events blue.
  - **Delete All** and **Factory Reset:** an orange confirm screen with ☒ Cancel (X) and ☑ Proceed (Check).
- **Keyboard:** Enter = Check, Backspace = X, ← and → = Left and Right.
- **Where slots live:** downloaded programs are stored in this browser (localStorage).

## VS Code + VEX extension look-alike (frontend `src/iq2/codeTab.ts`)
- **Theme:** VS Code's Dark Modern colours, with a menu bar, activity bar, side bar, editor tabs, breadcrumbs and a panel.
- **Activity bar:** Explorer, Search (disabled) and VEX.
- **VEX view:**
  - **Project Actions:** New Project and Import Project [KB-VSUI].
  - **VEX Device Info:** a Brain tree with System (name, which is editable, and VEXos), Programs (slots, with erase) and Devices (from the Build tab).
  - **Lab Programs:** the examples index. Opening one creates a project and also applies its robot preset and map.
  - **Projects:** projects saved in this browser.
- **New Project wizard** [KB-VSNEW]:
  1. **Platform:** only IQ 2nd Generation is enabled; V5, EXP and AIM are shown greyed out.
  2. **Language:** Python. C++ is greyed out.
  3. **Template:** searchable. Choices are Empty Project, Drivetrain 2-motor and All sensors.
  4. **Details:** Name, Description, SDK and Location. SDK and Location are shown but fixed.
- **Files created** [KB-AIR]:
  - `.vscode/vex_project_settings.json`. Its keys (project name, description, platform, language, slot, sdkVersion and python.main) are an ESTIMATE.
  - `.vscode/settings.json` and `.vscode/extensions.json`.
  - `src/main.py` with the VS Code module banner comment.
- **Status-bar toolbar** [KB-VSUI]:
  - Device Picker, Slot Selector (1–8), Download, Play, Stop, Project Selector and Python File Selector.
  - Download writes the selected Python file to the slot, printing log lines like the extension's ("Download User Program", "Download Finished").
  - Play runs the slot on the simulated brain and switches to the Simulator tab.
- **Terminals:** "Log Terminal" for download output, and "Interactive Terminal" for program `print`. The Interactive Terminal is cleared after a download, as in the extension's default.
- **Problems tab:** runtime errors with their line numbers. The editor highlights the error line.
