def parse_config(path):
    """Parse a config file."""
    with open(path) as fh:
        return fh.read()


class ConfigManager:
    def __init__(self):
        self.items = {}
