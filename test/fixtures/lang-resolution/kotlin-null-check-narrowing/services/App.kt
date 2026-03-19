package services

import models.User

fun processNullable(x: User?) {
    if (x != null) {
        x.save()
    }
}
