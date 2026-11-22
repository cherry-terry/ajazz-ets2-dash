// ETS2 Dash v2 — plugin for Euro Truck Simulator 2 / American Truck Simulator.
//  * Telemetry: JSON over UDP to 127.0.0.1:39421 every 100 ms (the Stream Dock plugin listens).
//  * Control: SCS Input SDK semantical input device. Commands arrive over UDP
//    on 127.0.0.1:39422 as text "down <mix>", "up <mix>", "release <mix>", "pulse <mix> <ms>".
//    No keyboard bindings are needed in the game.

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scssdk_telemetry.h"
#include "scssdk_input.h"
#include "eurotrucks2/scssdk_eut2.h"
#include "eurotrucks2/scssdk_telemetry_eut2.h"
#include "amtrucks/scssdk_ats.h"
#include "amtrucks/scssdk_telemetry_ats.h"
#include "common/scssdk_telemetry_common_configs.h"
#include "common/scssdk_telemetry_common_channels.h"
#include "common/scssdk_telemetry_truck_common_channels.h"
#include "common/scssdk_telemetry_trailer_common_channels.h"
#include "common/scssdk_telemetry_job_common_channels.h"

static const unsigned short TELEMETRY_PORT = 39421;
static const unsigned short COMMAND_PORT = 39422;
static const ULONGLONG SEND_INTERVAL_MS = 100;

static bool g_wsa = false;
static int g_wsa_users = 0;
static scs_log_t g_log = NULL;
static void log_msg(const char *m) { if (g_log) g_log(SCS_LOG_TYPE_message, m); }

static bool wsa_up() {
    if (g_wsa_users++ == 0) { WSADATA w; g_wsa = (WSAStartup(MAKEWORD(2, 2), &w) == 0); }
    return g_wsa;
}
static void wsa_down() {
    if (--g_wsa_users == 0 && g_wsa) { WSACleanup(); g_wsa = false; }
}

// =====================================================================
//                              TELEMETRY
// =====================================================================

struct Telemetry {
    // page 1
    float speed_limit, fuel, fuel_capacity, fuel_range, cruise, nav_distance, air_pressure;
    bool fuel_warning, air_warning, air_emergency;
    int gear;
    // page 2
    bool parking_brake, motor_brake, diff_lock, beacon, light_parking, low_beam, high_beam, hazard;
    unsigned retarder, retarder_steps;
    // page 3
    unsigned game_time, delivery_time;
    bool has_job;
    float cargo_damage, trl_wear_body, trl_wear_chassis, trl_wear_wheels;
    float fuel_avg, water_temp, oil_pressure;
    bool water_warning, oil_warning;
    // page 4
    bool trailer_connected, lift_axle, trailer_lift_axle;
    bool paused;
};

static Telemetry g_t;
static SOCKET g_tsock = INVALID_SOCKET;
static sockaddr_in g_taddr;
static ULONGLONG g_last_send = 0;

static SCSAPI_VOID store_float(const scs_string_t, const scs_u32_t, const scs_value_t *const v, const scs_context_t ctx) {
    *static_cast<float *>(ctx) = (v && v->type == SCS_VALUE_TYPE_float) ? v->value_float.value : 0.0f;
}
static SCSAPI_VOID store_s32(const scs_string_t, const scs_u32_t, const scs_value_t *const v, const scs_context_t ctx) {
    *static_cast<int *>(ctx) = (v && v->type == SCS_VALUE_TYPE_s32) ? v->value_s32.value : 0;
}
static SCSAPI_VOID store_u32(const scs_string_t, const scs_u32_t, const scs_value_t *const v, const scs_context_t ctx) {
    *static_cast<unsigned *>(ctx) = (v && v->type == SCS_VALUE_TYPE_u32) ? v->value_u32.value : 0u;
}
static SCSAPI_VOID store_bool(const scs_string_t, const scs_u32_t, const scs_value_t *const v, const scs_context_t ctx) {
    *static_cast<bool *>(ctx) = (v && v->type == SCS_VALUE_TYPE_bool) ? (v->value_bool.value != 0) : false;
}

#define B(x) ((x) ? "true" : "false")
static void send_packet() {
    if (g_tsock == INVALID_SOCKET) return;
    char buf[1400];
    const Telemetry &t = g_t;
    int n = snprintf(buf, sizeof(buf),
        "{\"v\":2,\"paused\":%s,"
        "\"speedLimit\":%.3f,\"fuel\":%.2f,\"fuelCapacity\":%.1f,\"fuelRange\":%.1f,\"fuelWarning\":%s,"
        "\"cruise\":%.3f,\"gear\":%d,\"navDistance\":%.1f,\"airPressure\":%.2f,\"airWarning\":%s,\"airEmergency\":%s,"
        "\"parkingBrake\":%s,\"motorBrake\":%s,\"retarder\":%u,\"retarderSteps\":%u,\"diffLock\":%s,\"beacon\":%s,"
        "\"lightParking\":%s,\"lowBeam\":%s,\"highBeam\":%s,\"hazard\":%s,"
        "\"gameTime\":%u,\"deliveryTime\":%u,\"hasJob\":%s,\"cargoDamage\":%.4f,"
        "\"trlWearBody\":%.4f,\"trlWearChassis\":%.4f,\"trlWearWheels\":%.4f,"
        "\"fuelAvg\":%.5f,\"waterTemp\":%.1f,\"waterWarning\":%s,\"oilPressure\":%.2f,\"oilWarning\":%s,"
        "\"trailerConnected\":%s,\"liftAxle\":%s,\"trailerLiftAxle\":%s}",
        B(t.paused),
        t.speed_limit, t.fuel, t.fuel_capacity, t.fuel_range, B(t.fuel_warning),
        t.cruise, t.gear, t.nav_distance, t.air_pressure, B(t.air_warning), B(t.air_emergency),
        B(t.parking_brake), B(t.motor_brake), t.retarder, t.retarder_steps, B(t.diff_lock), B(t.beacon),
        B(t.light_parking), B(t.low_beam), B(t.high_beam), B(t.hazard),
        t.game_time, t.delivery_time, B(t.has_job), t.cargo_damage,
        t.trl_wear_body, t.trl_wear_chassis, t.trl_wear_wheels,
        t.fuel_avg, t.water_temp, B(t.water_warning), t.oil_pressure, B(t.oil_warning),
        B(t.trailer_connected), B(t.lift_axle), B(t.trailer_lift_axle));
    if (n > 0 && n < (int)sizeof(buf))
        sendto(g_tsock, buf, n, 0, reinterpret_cast<sockaddr *>(&g_taddr), sizeof(g_taddr));
}

static SCSAPI_VOID on_frame_end(const scs_event_t, const void *const, const scs_context_t) {
    ULONGLONG now = GetTickCount64();
    if (now - g_last_send >= SEND_INTERVAL_MS) { g_last_send = now; send_packet(); }
}
static SCSAPI_VOID on_pause(const scs_event_t event, const void *const, const scs_context_t) {
    g_t.paused = (event == SCS_TELEMETRY_EVENT_paused);
    send_packet();
}
static SCSAPI_VOID on_config(const scs_event_t, const void *const info, const scs_context_t) {
    const scs_telemetry_configuration_t *cfg = static_cast<const scs_telemetry_configuration_t *>(info);
    if (!cfg) return;
    if (strcmp(cfg->id, SCS_TELEMETRY_CONFIG_truck) == 0) {
        for (const scs_named_value_t *a = cfg->attributes; a->name; ++a) {
            if (strcmp(a->name, SCS_TELEMETRY_CONFIG_ATTRIBUTE_fuel_capacity) == 0 && a->value.type == SCS_VALUE_TYPE_float)
                g_t.fuel_capacity = a->value.value_float.value;
            else if (strcmp(a->name, SCS_TELEMETRY_CONFIG_ATTRIBUTE_retarder_step_count) == 0 && a->value.type == SCS_VALUE_TYPE_u32)
                g_t.retarder_steps = a->value.value_u32.value;
        }
    } else if (strcmp(cfg->id, SCS_TELEMETRY_CONFIG_job) == 0) {
        g_t.has_job = false;
        g_t.delivery_time = 0;
        for (const scs_named_value_t *a = cfg->attributes; a->name; ++a) {
            if (strcmp(a->name, SCS_TELEMETRY_CONFIG_ATTRIBUTE_delivery_time) == 0 && a->value.type == SCS_VALUE_TYPE_u32) {
                g_t.delivery_time = a->value.value_u32.value;
                g_t.has_job = true;
            }
        }
    }
}

extern "C" __declspec(dllexport) SCSAPI_RESULT scs_telemetry_init(const scs_u32_t version, const scs_telemetry_init_params_t *const params) {
    if (version != SCS_TELEMETRY_VERSION_1_01) return SCS_RESULT_unsupported;
    const scs_telemetry_init_params_v101_t *p = static_cast<const scs_telemetry_init_params_v101_t *>(params);
    g_log = p->common.log;
    memset(&g_t, 0, sizeof(g_t));
    g_t.paused = true;

    if (wsa_up()) {
        g_tsock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        u_long nb = 1;
        if (g_tsock != INVALID_SOCKET) ioctlsocket(g_tsock, FIONBIO, &nb);
        memset(&g_taddr, 0, sizeof(g_taddr));
        g_taddr.sin_family = AF_INET;
        g_taddr.sin_port = htons(TELEMETRY_PORT);
        g_taddr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    }

    p->register_for_event(SCS_TELEMETRY_EVENT_frame_end, on_frame_end, NULL);
    p->register_for_event(SCS_TELEMETRY_EVENT_paused, on_pause, NULL);
    p->register_for_event(SCS_TELEMETRY_EVENT_started, on_pause, NULL);
    p->register_for_event(SCS_TELEMETRY_EVENT_configuration, on_config, NULL);

    const scs_u32_t I = SCS_U32_NIL;
    const scs_u32_t F = SCS_TELEMETRY_CHANNEL_FLAG_none;
#define CH_F(name, var) p->register_for_channel(name, I, SCS_VALUE_TYPE_float, F, store_float, &g_t.var)
#define CH_B(name, var) p->register_for_channel(name, I, SCS_VALUE_TYPE_bool,  F, store_bool,  &g_t.var)
#define CH_U(name, var) p->register_for_channel(name, I, SCS_VALUE_TYPE_u32,   F, store_u32,   &g_t.var)
#define CH_S(name, var) p->register_for_channel(name, I, SCS_VALUE_TYPE_s32,   F, store_s32,   &g_t.var)
    // page 1
    CH_F(SCS_TELEMETRY_TRUCK_CHANNEL_navigation_speed_limit, speed_limit);
    CH_F(SCS_TELEMETRY_TRUCK_CHANNEL_fuel, fuel);
    CH_F(SCS_TELEMETRY_TRUCK_CHANNEL_fuel_range, fuel_range);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_fuel_warning, fuel_warning);
    CH_F(SCS_TELEMETRY_TRUCK_CHANNEL_cruise_control, cruise);
    CH_S(SCS_TELEMETRY_TRUCK_CHANNEL_displayed_gear, gear);
    CH_F(SCS_TELEMETRY_TRUCK_CHANNEL_navigation_distance, nav_distance);
    CH_F(SCS_TELEMETRY_TRUCK_CHANNEL_brake_air_pressure, air_pressure);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_brake_air_pressure_warning, air_warning);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_brake_air_pressure_emergency, air_emergency);
    // page 2
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_parking_brake, parking_brake);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_motor_brake, motor_brake);
    CH_U(SCS_TELEMETRY_TRUCK_CHANNEL_retarder_level, retarder);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_differential_lock, diff_lock);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_light_beacon, beacon);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_light_parking, light_parking);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_light_low_beam, low_beam);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_light_high_beam, high_beam);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_hazard_warning, hazard);
    // page 3
    CH_U(SCS_TELEMETRY_CHANNEL_game_time, game_time);
    CH_F(SCS_TELEMETRY_JOB_CHANNEL_cargo_damage, cargo_damage);
    CH_F(SCS_TELEMETRY_TRUCK_CHANNEL_fuel_average_consumption, fuel_avg);
    CH_F(SCS_TELEMETRY_TRUCK_CHANNEL_water_temperature, water_temp);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_water_temperature_warning, water_warning);
    CH_F(SCS_TELEMETRY_TRUCK_CHANNEL_oil_pressure, oil_pressure);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_oil_pressure_warning, oil_warning);
    // trailer: newer game versions use "trailer.0.*", older ones "trailer.*"
    CH_B("trailer.0.connected", trailer_connected);      CH_B(SCS_TELEMETRY_TRAILER_CHANNEL_connected, trailer_connected);
    CH_F("trailer.0.wear.body", trl_wear_body);          CH_F(SCS_TELEMETRY_TRAILER_CHANNEL_wear_body, trl_wear_body);
    CH_F("trailer.0.wear.chassis", trl_wear_chassis);    CH_F(SCS_TELEMETRY_TRAILER_CHANNEL_wear_chassis, trl_wear_chassis);
    CH_F("trailer.0.wear.wheels", trl_wear_wheels);      CH_F(SCS_TELEMETRY_TRAILER_CHANNEL_wear_wheels, trl_wear_wheels);
    // page 4
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_lift_axle, lift_axle);
    CH_B(SCS_TELEMETRY_TRUCK_CHANNEL_trailer_lift_axle, trailer_lift_axle);

    log_msg("[ets2dash] telemetry ready -> UDP 127.0.0.1:39421");
    return SCS_RESULT_ok;
}

extern "C" __declspec(dllexport) SCSAPI_VOID scs_telemetry_shutdown(void) {
    if (g_tsock != INVALID_SOCKET) { closesocket(g_tsock); g_tsock = INVALID_SOCKET; }
    wsa_down();
}

// =====================================================================
//                               CONTROL
// =====================================================================
// Names are controls.sii "mix" entries that accept a semantical input.

struct InputDef { const char *name; const char *display; };
static const InputDef INPUTS[] = {
    {"parkingbrake", "Parking brake"}, {"engbraketog", "Engine brake toggle"}, {"motorbrake", "Engine brake"},
    {"retarderup", "Retarder up"}, {"retarderdown", "Retarder down"}, {"retarder0", "Retarder off"},
    {"diflock", "Differential lock"}, {"beacon", "Beacon"}, {"light", "Lights"}, {"hblight", "High beam"},
    {"flasher4way", "Hazard"}, {"horn", "Horn"}, {"cabinlight", "Cabin light"},
    {"cruiectrl", "Cruise control"}, {"cruiectrlinc", "Cruise increase"}, {"cruiectrldec", "Cruise decrease"},
    {"liftaxle", "Lift axle"}, {"liftaxlet", "Trailer lift axle"}, {"attach", "Attach trailer"},
    {"trailerbrake", "Trailer brake"},
    {"slideaxleman", "Slide axle manual"}, {"slideaxlefwd", "Slide axle forward"}, {"slideaxlebwd", "Slide axle backward"},
    {"frontsuspup", "Front suspension up"}, {"frontsuspdwn", "Front suspension down"},
    {"rearsuspup", "Rear suspension up"}, {"rearsuspdwn", "Rear suspension down"},
    {"trlrsuspup", "Trailer suspension up"}, {"trlrsuspdwn", "Trailer suspension down"},
    {"suspreset", "Suspension reset"},
    {"winlshadeup", "Left shade up"}, {"winlshadedwn", "Left shade down"},
    {"winrshadeup", "Right shade up"}, {"winrshadedwn", "Right shade down"},
    {"lwinopen", "Left window open"}, {"lwinclose", "Left window close"},
    {"rwinopen", "Right window open"}, {"rwinclose", "Right window close"},
    {"entrdoors", "Entrance doors"}, {"parking_cams", "Parking cameras"},
    {"wipers", "Wipers"}, {"wipersback", "Wipers back"},
};
static const unsigned N_INPUTS = sizeof(INPUTS) / sizeof(INPUTS[0]);

static scs_input_device_input_t g_inputs[N_INPUTS];
static bool g_state[N_INPUTS];          // value currently reported to the game
static bool g_held[N_INPUTS];           // held by a "down" command
static ULONGLONG g_release_at[N_INPUTS];// for "pulse": when to release (0 = inactive)
static unsigned g_press_frame[N_INPUTS];
static unsigned g_frame = 0;

struct Ev { unsigned idx; bool val; };
static Ev g_queue[512];
static unsigned g_qhead = 0, g_qtail = 0;
static SOCKET g_csock = INVALID_SOCKET;

static void push_event(unsigned idx, bool val) {
    unsigned next = (g_qtail + 1) % 512;
    if (next == g_qhead) return; // queue full - drop
    g_queue[g_qtail].idx = idx; g_queue[g_qtail].val = val; g_qtail = next;
}
static void set_state(unsigned idx, bool val) {
    if (g_state[idx] == val) return;
    g_state[idx] = val;
    if (val) g_press_frame[idx] = g_frame;
    push_event(idx, val);
}
static int find_input(const char *name) {
    for (unsigned i = 0; i < N_INPUTS; ++i) if (strcmp(INPUTS[i].name, name) == 0) return (int)i;
    return -1;
}
static void handle_command(char *line) {
    char cmd[16] = {0}, name[48] = {0};
    int ms = 0;
    if (sscanf(line, "%15s %47s %d", cmd, name, &ms) < 2) return;
    int idx = find_input(name);
    if (idx < 0) return;
    if (strcmp(cmd, "down") == 0) {
        g_held[idx] = true; set_state(idx, true);
    } else if (strcmp(cmd, "up") == 0) {
        g_held[idx] = false;
        if (g_state[idx] && !g_release_at[idx]) g_release_at[idx] = 1; // not earlier than the next frame
    } else if (strcmp(cmd, "release") == 0) { // release now (encoder changed direction)
        g_held[idx] = false;
        if (g_state[idx]) g_release_at[idx] = 1; // released on the next allowed frame
    } else if (strcmp(cmd, "pulse") == 0) {
        if (ms < 30) ms = 30;
        if (ms > 5000) ms = 5000;
        ULONGLONG until = GetTickCount64() + (ULONGLONG)ms;
        if (until > g_release_at[idx]) g_release_at[idx] = until;
        set_state(idx, true);
    }
}
static void poll_commands(bool discard) {
    if (g_csock == INVALID_SOCKET) return;
    char buf[256];
    for (int guard = 0; guard < 64; ++guard) {
        int n = recv(g_csock, buf, sizeof(buf) - 1, 0);
        if (n <= 0) break;
        if (discard) continue;
        buf[n] = 0;
        handle_command(buf);
    }
}
static void process_releases() {
    ULONGLONG now = GetTickCount64();
    for (unsigned i = 0; i < N_INPUTS; ++i) {
        // release once time is up and the game has seen the press for at least one full frame
        if (g_release_at[i] && now >= g_release_at[i] && g_frame > g_press_frame[i] + 1) {
            g_release_at[i] = 0;
            if (!g_held[i]) set_state(i, false);
        }
    }
}
static void reset_inputs() {
    for (unsigned i = 0; i < N_INPUTS; ++i) { g_held[i] = false; g_release_at[i] = 0; set_state(i, false); }
}

static SCSAPI_VOID input_active(const scs_u8_t active, const scs_context_t) {
    if (!active) { // game deactivated the device (menu, focus lost): release everything
        g_qhead = g_qtail = 0;
        for (unsigned i = 0; i < N_INPUTS; ++i) { g_held[i] = false; g_release_at[i] = 0; g_state[i] = false; }
    }
}

static SCSAPI_RESULT input_event(scs_input_event_t *const ev, const scs_u32_t flags, const scs_context_t) {
    if (flags & SCS_INPUT_EVENT_CALLBACK_FLAG_first_in_frame) {
        ++g_frame;
        if (flags & SCS_INPUT_EVENT_CALLBACK_FLAG_first_after_activation) {
            poll_commands(true); // drop commands that piled up while the game was inactive
            reset_inputs();
        } else {
            poll_commands(false);
        }
        process_releases();
    }
    if (g_qhead == g_qtail) return SCS_RESULT_not_found;
    ev->input_index = g_queue[g_qhead].idx;
    ev->value_bool.value = g_queue[g_qhead].val ? 1 : 0;
    g_qhead = (g_qhead + 1) % 512;
    return SCS_RESULT_ok;
}

extern "C" __declspec(dllexport) SCSAPI_RESULT scs_input_init(const scs_u32_t version, const scs_input_init_params_t *const params) {
    if (version != SCS_INPUT_VERSION_1_00) return SCS_RESULT_unsupported;
    const scs_input_init_params_v100_t *p = static_cast<const scs_input_init_params_v100_t *>(params);
    if (!g_log) g_log = p->common.log;

    for (unsigned i = 0; i < N_INPUTS; ++i) {
        memset(&g_inputs[i], 0, sizeof(g_inputs[i]));
        g_inputs[i].name = INPUTS[i].name;
        g_inputs[i].display_name = INPUTS[i].display;
        g_inputs[i].value_type = SCS_VALUE_TYPE_bool;
        g_state[i] = g_held[i] = false; g_release_at[i] = 0; g_press_frame[i] = 0;
    }

    scs_input_device_t dev;
    memset(&dev, 0, sizeof(dev));
    dev.name = "ets2dash";
    dev.display_name = "ETS2 Dash";
    dev.type = SCS_INPUT_DEVICE_TYPE_semantical;
    dev.input_count = N_INPUTS;
    dev.inputs = g_inputs;
    dev.callback_context = NULL;
    dev.input_active_callback = input_active;
    dev.input_event_callback = input_event;
    if (p->register_device(&dev) != SCS_RESULT_ok) {
        log_msg("[ets2dash] input device registration FAILED");
        return SCS_RESULT_generic_error;
    }

    if (wsa_up()) {
        g_csock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (g_csock != INVALID_SOCKET) {
            u_long nb = 1; ioctlsocket(g_csock, FIONBIO, &nb);
            sockaddr_in a; memset(&a, 0, sizeof(a));
            a.sin_family = AF_INET; a.sin_port = htons(COMMAND_PORT); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
            if (bind(g_csock, reinterpret_cast<sockaddr *>(&a), sizeof(a)) != 0) {
                log_msg("[ets2dash] cannot bind command port 39422");
                closesocket(g_csock); g_csock = INVALID_SOCKET;
            }
        }
    }
    log_msg("[ets2dash] input device ready <- UDP 127.0.0.1:39422");
    return SCS_RESULT_ok;
}

extern "C" __declspec(dllexport) SCSAPI_VOID scs_input_shutdown(void) {
    if (g_csock != INVALID_SOCKET) { closesocket(g_csock); g_csock = INVALID_SOCKET; }
    wsa_down();
}

BOOL APIENTRY DllMain(HMODULE, DWORD, LPVOID) { return TRUE; }
