import unittest

from app.carparks.ura_rates import parse_ura_rate_schedules, project_ura_car_rates


DETAIL_ROWS = [
    {
        "ppCode": "x0001",
        "vehCat": "C",
        "startTime": "07.00 AM",
        "endTime": "08.30 AM",
        "weekdayRate": "$0.60",
        "weekdayMin": "30 mins",
        "satdayRate": "$0.80",
        "satdayMin": "30 mins",
        "sunPHRate": "$0.00",
        "sunPHMin": "0 mins",
        "remarks": "Car tariff",
    },
    {
        "ppCode": "X0001",
        "vehCat": "C",
        "startTime": "08.30 AM",
        "endTime": "05.00 PM",
        "weekdayRate": "$1.20",
        "weekdayMin": "60 mins",
        "satdayRate": "$1.40",
        "satdayMin": "60 mins",
        "sunPHRate": "$0.00",
        "sunPHMin": "0 mins",
    },
    {
        "ppCode": "X0001",
        "vehCat": "M",
        "startTime": "07.00 AM",
        "endTime": "05.00 PM",
        "weekdayRate": "$0.20",
        "weekdayMin": "30 mins",
    },
    {
        "ppCode": "X0001",
        "vehCat": "C",
        "startTime": "05.00 PM",
        "endTime": "07.00 AM",
        "weekdayRate": "$0.00",
        "weekdayMin": "0 mins",
        "sunPHRate": "$0.00",
        "sunPHMin": "0 mins",
    },
    {"vehCat": "C", "startTime": "07.00 AM", "endTime": "08.00 AM"},
    None,
]


class UraRateScheduleTests(unittest.TestCase):
    def test_parser_groups_valid_rows_and_retains_vehicle_categories(self):
        schedules = parse_ura_rate_schedules(DETAIL_ROWS)

        self.assertEqual(len(schedules["X0001"]), 4)
        self.assertEqual(schedules["X0001"][0].vehicle_type, "C")
        self.assertEqual(schedules["X0001"][2].vehicle_type, "M")
        self.assertEqual(schedules["X0001"][0].remarks, "Car tariff")

    def test_projection_keeps_order_and_formats_ura_minimums(self):
        schedules = parse_ura_rate_schedules(DETAIL_ROWS)["X0001"]

        projected = project_ura_car_rates(schedules)

        self.assertEqual(projected["weekdays_rate_2"], None)
        self.assertEqual(
            projected["weekdays_rate_1"],
            "07.00 AM-08.30 AM: $0.60 per 30 mins\n"
            "08.30 AM-05.00 PM: $1.20 per hr\n"
            "05.00 PM-07.00 AM: Free parking",
        )
        self.assertEqual(
            projected["saturday_rate"],
            "07.00 AM-08.30 AM: $0.80 per 30 mins\n08.30 AM-05.00 PM: $1.40 per hr",
        )
        self.assertEqual(
            projected["sunday_ph_rate"],
            "07.00 AM-08.30 AM: Free parking\n08.30 AM-05.00 PM: Free parking\n05.00 PM-07.00 AM: Free parking",
        )

    def test_projection_returns_none_when_no_car_rows_exist(self):
        schedules = parse_ura_rate_schedules([
            {
                "ppCode": "X0001",
                "vehCat": "M",
                "startTime": "07.00 AM",
                "endTime": "08.00 AM",
                "weekdayRate": "$0.20",
                "weekdayMin": "30 mins",
            }
        ])["X0001"]

        self.assertEqual(
            project_ura_car_rates(schedules),
            {
                "weekdays_rate_1": None,
                "weekdays_rate_2": None,
                "saturday_rate": None,
                "sunday_ph_rate": None,
            },
        )


if __name__ == "__main__":
    unittest.main()
