import time
import math
from machine import Pin, PWM

CENTER = 90

PAN_CENTER_OFFSET = 0
PAN_CENTER = CENTER + PAN_CENTER_OFFSET
MAX_LEFT = 30
MAX_RIGHT = -30
PAN_SWING = min(abs(MAX_LEFT), abs(MAX_RIGHT))

TILT_CENTER_OFFSET = 0
TILT_CENTER = CENTER + TILT_CENTER_OFFSET
MAX_UP = -10
MAX_DOWN = 10
TILT_SWING = min(abs(MAX_UP), abs(MAX_DOWN))

# connector 8 = GPIO 27
servo_pan = PWM(Pin(27), freq=50)
# connector 9 = GPIO 15
servo_tilt = PWM(Pin(15), freq=50)
ANIMATION_SPEED = 600

def angle_to_duty(degrees: int) -> int:
    min_us = 500
    max_us = 2500
    period_us = 20_000  # 50 Hz
    pulse_us = min_us + (max_us - min_us) * degrees // 180
    return int(pulse_us / period_us * 65535)

def move_to(servo: PWM, degrees: int) -> None:
    servo.duty_u16(angle_to_duty(degrees))

try:
    move_to(servo_pan, PAN_CENTER)
    move_to(servo_tilt, TILT_CENTER)
    time.sleep(10)
finally:
    servo_pan.deinit()
    servo_tilt.deinit()