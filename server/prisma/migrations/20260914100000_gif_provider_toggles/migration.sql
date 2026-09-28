-- Each provider can be switched off on its own, keeping its key.
ALTER TABLE `GifSetting` ADD COLUMN `giphyOn` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `GifSetting` ADD COLUMN `klipyOn` BOOLEAN NOT NULL DEFAULT true;
