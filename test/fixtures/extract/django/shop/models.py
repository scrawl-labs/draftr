from django.db import models

class Base(models.Model):
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True

class Customer(Base):
    name = models.CharField(max_length=80)

class Order(Base):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    parent = models.ForeignKey("self", null=True, on_delete=models.SET_NULL)
    total = models.DecimalField(max_digits=10, decimal_places=2)
